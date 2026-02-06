export type IncomingMessage = {
  channel: "telegram" | "whatsapp" | "slack" | "terminal";
  sender: string;
  senderName: string;
  text: string;
  timestamp: number;
  raw?: unknown;
};

export type ReplyFn = (text: string) => Promise<void>;

export type ChannelAdapter = {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => void): void;
};
