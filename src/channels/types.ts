export type Attachment = {
  type: "audio" | "image" | "video" | "document" | "sticker" | "voice";
  filePath: string;
  mimeType?: string;
  fileName?: string;
  duration?: number;
  caption?: string;
};

export type IncomingMessage = {
  channel: "telegram" | "whatsapp" | "slack" | "terminal";
  sender: string;
  senderName: string;
  text: string;
  timestamp: number;
  attachments?: Attachment[];
  raw?: unknown;
};

export type ReplyFn = (text: string) => Promise<void>;

export type ChannelAdapter = {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (msg: IncomingMessage, reply: ReplyFn) => void): void;
};
