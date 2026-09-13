import { Agent } from "../core/agent.js";
import type { AgentTool, ModelInfo } from "../core/types.js";

export interface RuntimeImage {
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
  filename?: string;
}

export interface RuntimeRunContext {
  runId: string;
  model: ModelInfo;
  systemPrompt: string;
  tools?: AgentTool[];
  images?: RuntimeImage[];
}

export interface GradingRuntime {
  run(context: RuntimeRunContext, prompt: string, images?: RuntimeImage[]): Promise<string>;
  abort(runId: string): Promise<void>;
}

/**
 * Compatibility runtime used until the Pi adapter is installed. It preserves
 * the new one-run/one-agent contract so business code does not depend on the
 * concrete Agent implementation.
 */
export class LegacyGradingRuntime implements GradingRuntime {
  private readonly activeRuns = new Map<string, Agent>();

  async run(context: RuntimeRunContext, prompt: string, images: RuntimeImage[] = context.images || []): Promise<string> {
    if (this.activeRuns.has(context.runId)) {
      throw new Error(`Grading run ${context.runId} is already active`);
    }
    const agent = new Agent({
      initialState: {
        model: context.model,
        systemPrompt: context.systemPrompt,
        tools: context.tools || [],
        messages: [],
      },
    });
    this.activeRuns.set(context.runId, agent);
    try {
      return await agent.prompt(prompt, images);
    } finally {
      this.activeRuns.delete(context.runId);
    }
  }

  async abort(runId: string): Promise<void> {
    // The legacy loop has no cancellation token yet. Removing the run makes
    // future calls fail fast; Pi will provide true abort semantics.
    this.activeRuns.delete(runId);
  }
}
