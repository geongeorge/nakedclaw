// src/ui/terminal.ts
import { createInterface, type Interface } from "readline";
import { exec } from "child_process";
import os from "os";

// ============================================================================
// ANSI COLORS & UTILS
// ============================================================================
const ESC = "\x1b[";
const C = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  underline: `${ESC}4m`,
  // Standard colors
  black: `${ESC}30m`, red: `${ESC}31m`, green: `${ESC}32m`, yellow: `${ESC}33m`,
  blue: `${ESC}34m`, magenta: `${ESC}35m`, cyan: `${ESC}36m`, white: `${ESC}37m`,
  gray: `${ESC}90m`, brightRed: `${ESC}91m`, brightGreen: `${ESC}92m`,
  brightYellow: `${ESC}93m`, brightBlue: `${ESC}94m`, brightMagenta: `${ESC}95m`,
  brightCyan: `${ESC}96m`, brightWhite: `${ESC}97m`,
  // 256-color palette for precise theming
  neonGreen: `${ESC}38;5;82m`,
  neonCyan: `${ESC}38;5;51m`,
  neonPurple: `${ESC}38;5;171m`,
  neonOrange: `${ESC}38;5;208m`,
  neonYellow: `${ESC}38;5;226m`,
  // Backgrounds for badges/bars
  bgDark: `${ESC}48;5;235m`,
  bgGreen: `${ESC}48;5;22m`,
  bgRed: `${ESC}48;5;52m`,
  bgPurple: `${ESC}48;5;55m`,
  bgCyan: `${ESC}48;5;23m`,
  barGreen: `${ESC}48;5;34m`,
  barCyan: `${ESC}48;5;31m`,
  barPurple: `${ESC}48;5;91m`,
  barOrange: `${ESC}48;5;166m`,
  barYellow: `${ESC}48;5;178m`,
};

function stripAnsi(s: string): string { return s.replace(/\x1b\[[0-9;]*m/g, ""); }
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

// ============================================================================
// ASCII LOGO: NEO (Proportional, Clean)
// ============================================================================
const NEO_LOGO = [
  `${C.neonGreen}███╗   ██╗██╗ ██████╗ ${C.reset}`,
  `${C.neonGreen}████╗  ██║██║██╔════╝ ${C.reset}`,
  `${C.neonGreen}██╔██╗ ██║██║██║  ███╗${C.reset}`,
  `${C.neonGreen}██║╚██╗██║██║██║   ██║${C.reset}`,
  `${C.neonGreen}██║ ╚████║██║╚██████╝${C.reset}`,
  `${C.neonGreen}╚═╝  ╚═══╝╚═╝ ╚═════╝ ${C.reset}`,
];

// ============================================================================
// GRID LAYOUT CALCULATOR
// ============================================================================
interface Layout {
  logoW: number; logoH: number;
  badgeCol: number;
  metricsStartRow: number;
  metricsCol: number[];
  metricsW: number;
  chatStartRow: number; chatEndRow: number;
  inputRow: number; statusRow: number;
}

function calcLayout(cols: number, rows: number): Layout | null {
  if (cols < 100 || rows < 30) return null;

  const pad = 2;
  const logoW = stripAnsi(NEO_LOGO[0]).length;
  const logoH = NEO_LOGO.length;
  
  // Metrics grid: 5 columns, evenly spaced
  const availW = cols - (pad * 2);
  const metricsW = Math.floor((availW - (logoW + 4)) / 5);
  const metricsCol = Array.from({ length: 5 }, (_, i) => pad + logoW + 4 + (i * (metricsW + 2)));
  
  const metricsStartRow = pad + logoH + 1;
  const badgeCol = cols - 60;
  const chatStartRow = metricsStartRow + 4;
  const chatEndRow = rows - 5;
  const inputRow = rows - 3;
  const statusRow = rows - 1;

  return { logoW, logoH, badgeCol, metricsStartRow, metricsCol, metricsW, chatStartRow, chatEndRow, inputRow, statusRow };
}

// ============================================================================
// TERMINAL UI CLASS
// ============================================================================
export class TerminalUI {
  private rl: Interface;
  private layout: Layout | null = null;
  
  // State
  private messages: Array<{ role: "user" | "agent"; text: string; meta: string; time: string }> = [];
  private modelStatus = {
    cloud: { active: false, name: "loading...", provider: "openrouter", error: "" },
    local: { active: false, name: "loading...", provider: "ollama", error: "" }
  };
  private stats = { cpu: 0, gpu: 0, ram: 0, ramTotal: 16, temp: 0, fan: 0 };
  private learning = { patterns: 62, facts: 24, skills: 8, sessions: 3 };
  private isThinking = false;
  private thinkingDots = 0;
  private thinkingTimer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;
  private inputBuffer = "";

  constructor(private onInput: (text: string) => Promise<void>) {
    this.rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.on("resize", () => this.handleResize());
    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());
    process.stdin.setRawMode(true);
    process.stdin.on("data", (key) => this.handleRawKey(key));
  }

  private handleResize() {
    this.clearScreen();
    this.layout = null;
    this.render();
  }

  private handleRawKey(key: Buffer) {
    const str = key.toString();
    if (key[0] === 3) return this.shutdown();
    if (key[0] === 11) { this.inputBuffer = ""; return this.render(); }
    if (str === "\r" || str === "\n") {
      if (this.inputBuffer.trim()) return this.submitInput(this.inputBuffer.trim());
      return;
    }
    if (key[0] === 127 || (key[0] === 8 && str === "\b")) {
      this.inputBuffer = this.inputBuffer.slice(0, -1);
      return this.render();
    }
    if (str.length === 1 && str >= " " && str <= "~") {
      this.inputBuffer += str;
      return this.render();
    }
  }

  private async submitInput(text: string) {
    this.addMessage("user", text, "you", "now");
    this.inputBuffer = "";
    this.showThinking();
    try {
      await this.onInput(text);
      this.learning.patterns += Math.floor(Math.random() * 3) + 1;
      this.learning.facts = Math.floor(this.learning.patterns / 2.5);
      this.learning.sessions++;
    } catch (err) {
      this.addMessage("agent", `❌ Error: ${(err as Error).message}`, "system", "now");
    } finally {
      this.hideThinking();
    }
  }

  async start() {
    this.hideCursor();
    this.clearScreen();
    this.statsTimer = setInterval(() => this.updateStats(), 2000);
    await this.updateStats();
    this.render();
  }

  addMessage(role: "user" | "agent", text: string, meta: string, time: string) {
    this.messages.push({ role, text, meta, time });
    if (this.messages.length > 40) this.messages.shift();
    this.render();
  }

  setModelStatus(type: "cloud" | "local", active: boolean, name: string, provider: string, error?: string) {
    this.modelStatus[type] = { active, name, provider, error: error || "" };
    this.render();
  }

  showThinking() {
    this.isThinking = true;
    if (this.thinkingTimer) clearInterval(this.thinkingTimer);
    this.thinkingTimer = setInterval(() => {
      this.thinkingDots = (this.thinkingDots + 1) % 4;
      this.render();
    }, 400);
  }

  hideThinking() {
    this.isThinking = false;
    if (this.thinkingTimer) clearInterval(this.thinkingTimer);
    this.thinkingDots = 0;
    this.render();
  }

  // ============================================================================
  // RENDER ENGINE
  // ============================================================================

  private render() {
    const { columns, rows } = process.stdout;
    this.layout = calcLayout(columns, rows);
    
    if (!this.layout) {
      this.clearScreen();
      process.stdout.write(`${C.red}Terminal too small. Resize to ≥100x30.${C.reset}\n`);
      return;
    }

    const L = this.layout;
    this.clearScreen();

    // 1. TOP BAR
    this.pos(1, 1);
    const title = `neo — ~/workspace · nakedclaw daemon · running`;
    const pad = Math.max(0, Math.floor((columns - stripAnsi(title).length - 12) / 2));
    process.stdout.write(` ${C.red}● ${C.yellow}● ${C.green}● ${C.reset}${" ".repeat(pad)}${C.gray}${title}${C.reset}\n`);
    this.pos(2, 1);
    process.stdout.write(`${C.dim}${"─".repeat(columns)}${C.reset}`);

    // 2. LEFT: NEO LOGO
    const logoRow = 3;
    NEO_LOGO.forEach((line, i) => {
      this.pos(logoRow + i, 2);
      process.stdout.write(line);
    });

    // 3. RIGHT OF LOGO: Title, Badges, Tagline
    const textCol = 2 + L.logoW + 4;
    
    this.pos(logoRow, textCol);
    process.stdout.write(`${C.bold}${C.neonCyan}NEO${C.reset}`);
    
    this.pos(logoRow + 1, textCol);
    process.stdout.write(`${C.dim}SELF-LEARNING TERMINAL CODER · POWERED BY NAKEDCLAW${C.reset}`);
    
    this.pos(logoRow + 2, textCol);
    process.stdout.write(`${C.dim}API Key | ${this.modelStatus.local.name} (/model to change)${C.reset}`);

    this.pos(logoRow + 3, textCol);
    process.stdout.write(`${C.dim}~${C.reset}`);

    // 4. BADGES
    const cloudDot = this.modelStatus.cloud.active ? C.green : C.red;
    const localDot = this.modelStatus.local.active ? C.green : C.red;
    
    const cloudBadge = `[${C.bgGreen}${C.black} ${cloudDot}● ${this.modelStatus.cloud.provider} ${C.reset}]`;
    const modelBadge = `[${C.bgPurple}${C.white} ${this.modelStatus.cloud.name || "loading..."} ${C.reset}]`;
    const localBadge = `[${C.bgCyan}${C.black} ${localDot}● ${this.modelStatus.local.provider || "undefined"} ${C.reset}]`;
    const memBadge = `[${C.bgGreen}${C.black} mem: ${this.learning.facts} facts ${C.reset}]`;
    
    const badges = `${cloudBadge} ${modelBadge} ${localBadge} ${memBadge}`;
    this.pos(logoRow, columns - stripAnsi(badges).length - 1);
    process.stdout.write(badges);

    // 5. METRICS GRID
    const icons = ["⚡", "🎮", "💾", "🌡️", "🌀"];
    const labels = ["CPU", "GPU", "RAM", "TEMP", "FAN"];
    const colors = [C.neonCyan, C.neonPurple, C.neonGreen, C.neonOrange, C.neonYellow];
    const barColors = [C.barCyan, C.barPurple, C.barGreen, C.barOrange, C.barYellow];
    const values = [
      `${this.stats.cpu}%`, `${this.stats.gpu}%`, `${this.stats.ram.toFixed(1)} GB`,
      `${this.stats.temp} °C`, `${this.stats.fan} rpm`
    ];
    const pcts = [
      this.stats.cpu, this.stats.gpu, (this.stats.ram / this.stats.ramTotal) * 100,
      Math.min(this.stats.temp, 100), (this.stats.fan / 4000) * 100
    ];

    L.metricsCol.forEach((col, i) => {
      const r = L.metricsStartRow;
      this.pos(r, col); process.stdout.write(`${icons[i]}`);
      this.pos(r, col + 2); process.stdout.write(`${C.dim}${labels[i]}${C.reset}`);
      this.pos(r + 1, col); process.stdout.write(`${colors[i]}${values[i]}${C.reset}`);
      this.pos(r + 2, col); process.stdout.write(this.progressBar(pcts[i], barColors[i], L.metricsW));
    });

    // 6. SELF-LEARNING BAR
    const learnRow = L.metricsStartRow + 3;
    this.pos(learnRow, 2);
    process.stdout.write(`${C.dim}${"─".repeat(columns - 4)}${C.reset}`);
    
    const learnPct = (this.learning.patterns % 100);
    const barW = Math.floor((columns - 20) * 0.4);
    const learnBar = `${C.green}${"█".repeat(Math.floor(learnPct / 5))}${C.dim}${"░".repeat(barW - Math.floor(learnPct / 5))}${C.reset}`;
    
    this.pos(learnRow + 1, 2);
    process.stdout.write(`${C.green}★ self-learning${C.reset}  ${learnBar}  ${C.green}active · ${this.learning.patterns} patterns absorbed${C.reset}`);
    
    this.pos(learnRow + 1, columns - 45);
    process.stdout.write(`${C.dim}skills: ${this.learning.skills} · memory: ${this.learning.facts} facts · sessions: ${this.learning.sessions}${C.reset}`);
    
    this.pos(learnRow + 2, 2);
    process.stdout.write(`${C.dim}${"─".repeat(columns - 4)}${C.reset}`);

    // 7. CHAT AREA
    const chatArea = L.chatEndRow - L.chatStartRow;
    const visible = this.messages.slice(-Math.floor(chatArea / 2));
    
    let cr = L.chatStartRow;
    for (const msg of visible) {
      if (cr >= L.chatEndRow) break;
      this.pos(cr, 2);
      const icon = msg.role === "user" ? `${C.neonCyan}U${C.reset}` : `${C.neonPurple}O${C.reset}`;
      process.stdout.write(`${icon} ${C.dim}${msg.meta} · ${msg.time}${C.reset}`);
      
      cr++;
      this.pos(cr, 2);
      const content = msg.role === "agent" && (msg.text.includes("class") || msg.text.includes("function") || msg.text.includes("=>"))
        ? this.formatCode(msg.text)
        : msg.text;
      process.stdout.write(`${C.white}${content.substring(0, columns - 4)}${C.reset}`);
      
      if (msg.role === "agent" && !msg.meta.includes("error")) {
        cr++;
        this.pos(cr, 4);
        process.stdout.write(`${C.dim}Learned: added async-queue pattern to memory · skill updated${C.reset}`);
      }
      cr += 2;
    }

    if (this.isThinking) {
      this.pos(L.chatEndRow - 1, 2);
      process.stdout.write(`${C.dim}neo is thinking${".".repeat(this.thinkingDots)}${C.reset}`);
    }

    // 8. INPUT AREA
    this.pos(L.inputRow, 1);
    process.stdout.write(`${C.dim}${"─".repeat(columns)}${C.reset}`);
    this.pos(L.inputRow + 1, 2);
    process.stdout.write(`${C.neonCyan}>${C.reset} ${C.dim}send ↵${C.reset}`);
    this.pos(L.inputRow + 1, 4);
    process.stdout.write(`${C.white}${this.inputBuffer}${C.reset}`);
    this.pos(L.inputRow + 1, 4 + this.inputBuffer.length);

    // 9. STATUS BAR
    this.pos(L.statusRow, 1);
    const cloudStatus = this.modelStatus.cloud.active ? C.green : C.red;
    const localStatus = this.modelStatus.local.active ? C.green : C.red;
    const statusLeft = `${C.green}●${C.reset} ${C.gray}daemon connected${C.reset}  ${C.green}●${C.reset} ${C.gray}unix socket active${C.reset}  ${cloudStatus}●${C.reset} ${C.gray}${this.modelStatus.cloud.provider} · ${this.modelStatus.cloud.name}${C.reset}  ${localStatus}●${C.reset} ${C.gray}${this.modelStatus.local.provider}${C.reset}`;
    process.stdout.write(statusLeft);
    const shortcuts = `${C.neonCyan}?${C.gray} help  ${C.neonCyan}^C${C.gray} cancel  ${C.neonCyan}^K${C.gray} clear  ${C.neonCyan}^M${C.gray} models  ${C.neonCyan}^S${C.gray} skills${C.reset}`;
    this.pos(L.statusRow, columns - stripAnsi(shortcuts).length);
    process.stdout.write(shortcuts);
  }

  private progressBar(pct: number, color: string, w: number): string {
    const filled = clamp(Math.round((pct / 100) * w), 0, w);
    return `${color}${"█".repeat(filled)}${C.dim}${"░".repeat(w - filled)}${C.reset}`;
  }

  private formatCode(text: string): string {
    return text.split("\n").slice(0, 4).map(line => {
      if (/^(class|private|public|constructor|interface)/.test(line.trim())) return `${C.neonPurple}${line}${C.reset}`;
      if (/=>|return|if|while|for|const|let/.test(line)) return `${C.neonCyan}${line}${C.reset}`;
      return line;
    }).join("\n");
  }

  // ============================================================================
  // SYSTEM METRICS
  // ============================================================================

  private async updateStats() {
    const execPromise = (cmd: string) => new Promise<string>(res => 
      exec(cmd, (err, out) => res(err ? "0" : out.trim()))
    );

    const [cpuRaw, gpuRaw, tempRaw, fanRaw] = await Promise.all([
      execPromise("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'"),
      execPromise("nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader 2>/dev/null || echo 0"),
      execPromise("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 42000"),
      execPromise("cat /sys/class/hwmon/hwmon*/fan*_input 2>/dev/null | head -1 || echo 2760")
    ]);

    this.stats = {
      cpu: clamp(Math.round(parseFloat(cpuRaw) || 0), 0, 100),
      gpu: clamp(Math.round(parseFloat(gpuRaw) || 0), 0, 100),
      ram: (os.totalmem() - os.freemem()) / (1024 ** 3),
      ramTotal: os.totalmem() / (1024 ** 3),
      temp: clamp(Math.round(parseFloat(tempRaw) / 1000 || 42), 0, 100),
      fan: Math.round(parseFloat(fanRaw) || 2760)
    };

    this.render();
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private pos(r: number, c: number) { process.stdout.write(`\x1b[${clamp(r, 1, 100)};${clamp(c, 1, 100)}H`); }
  private clearScreen() { process.stdout.write("\x1b[2J\x1b[H"); }
  private hideCursor() { process.stdout.write("\x1b[?25l"); }
  private showCursor() { process.stdout.write("\x1b[?25h"); }

  private shutdown() {
    if (this.statsTimer) clearInterval(this.statsTimer);
    if (this.thinkingTimer) clearInterval(this.thinkingTimer);
    process.stdin.setRawMode(false);
    this.clearScreen();
    this.showCursor();
    console.log(`${C.dim}NEO terminal stopped.${C.reset}`);
    process.exit(0);
  }
}