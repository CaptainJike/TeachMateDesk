import type { ModelInfo } from "../core/types.js";

export type ModelTier = "TIER_1_FAST" | "TIER_2_STANDARD" | "TIER_3_DEEP";

/**
 * One vendor-neutral multimodal model for every agent. Tiers remain as
 * business routing metadata, but never select another provider or a separate vision API.
 */
export function getTierModel(_tier: ModelTier = "TIER_2_STANDARD"): ModelInfo {
  const provider = process.env.PI_MODEL_PROVIDER || "deepseek";
  // Pi resolves this ID against its provider catalog. Keep the default aligned
  // with DeepSeek's current official multimodal model ID.
  const modelId = process.env.PI_MODEL_ID || "deepseek-flash";
  const apiKey = process.env.PI_MODEL_API_KEY || "";
  const baseUrl = (process.env.PI_MODEL_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");

  return {
    id: modelId,
    name: `Pi Multimodal [${modelId}]`,
    api: "openai-completions",
    provider,
    baseUrl,
    apiKey,
    reasoning: true,
    input: ["text", "image"],
    supportsImages: process.env.PI_MODEL_SUPPORTS_IMAGES !== "false",
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 32_768,
  };
}
