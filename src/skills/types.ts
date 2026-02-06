export type SkillMetadata = {
  always?: boolean;
  emoji?: string;
  homepage?: string;
  os?: string[];
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
  };
  install?: SkillInstallSpec[];
};

export type SkillInstallSpec = {
  id?: string;
  kind: "brew" | "node" | "go" | "uv" | "download" | "apt";
  label?: string;
  bins?: string[];
  os?: string[];
  formula?: string;
  tap?: string;
  package?: string;
  module?: string;
  url?: string;
};

export type SkillEntry = {
  name: string;
  description: string;
  metadata?: SkillMetadata;
  body: string;
  filePath: string;
  source: "openclaw" | "local";
};

export type SkillStatus = {
  name: string;
  description: string;
  emoji?: string;
  eligible: boolean;
  installed: boolean;
  missing: {
    bins: string[];
    env: string[];
  };
  install?: { label: string; id: string; kind: string }[];
};
