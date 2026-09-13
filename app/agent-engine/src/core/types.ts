import type { TSchema, Static } from "@sinclair/typebox";

export interface ModelInfo {
  id: string;
  name: string;
  api: "openai-completions" | "zhipu" | "deepseek" | "mock";
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  reasoning: boolean;
  input: string[];
  supportsImages?: boolean;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}

export type MessageRole = "system" | "user" | "assistant" | "tool" | "toolResult";

export interface TextContentBlock {
  type: "text";
  text: string;
}

export interface ImageContentBlock {
  type: "image";
  source: {
    type: "base64";
    mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
}

export interface ToolCallBlock {
  type: "tool_call";
  id: string;
  name: string;
  arguments: any;
}

export interface ToolResultBlock {
  type: "tool_result";
  toolCallId: string;
  toolName: string;
  result: any;
}

export type ContentBlock = TextContentBlock | ImageContentBlock | ToolCallBlock | ToolResultBlock;

export interface AgentMessage {
  role: MessageRole;
  content: string | ContentBlock[];
}

export interface AgentTool<T extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: T;
  execute: (args: Static<T>, context?: any) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    details?: any;
  }>;
}

export interface BeforeToolCallContext {
  toolCall: {
    id: string;
    name: string;
    arguments: any;
  };
  args: any;
}

export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
  modifiedArgs?: any;
}

export interface AfterToolCallContext {
  toolCall: {
    id: string;
    name: string;
    arguments: any;
  };
  result: {
    content: Array<{ type: "text"; text: string }>;
    details?: any;
  };
}

export interface AfterToolCallResult {
  overrideResult?: any;
}

export interface AgentState {
  model: ModelInfo;
  tools: AgentTool<any>[];
  systemPrompt: string;
  messages: AgentMessage[];
  isStreaming?: boolean;
}

export interface AgentEvent {
  type: "start" | "token" | "tool_call_start" | "tool_call_end" | "done" | "error";
  data?: any;
}
