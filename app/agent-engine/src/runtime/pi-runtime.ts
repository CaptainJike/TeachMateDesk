import type { GradingRuntime, RuntimeImage, RuntimeRunContext } from "./grading-runtime.js";

/**
 * Optional Pi SDK runtime. The dependency is loaded lazily so deployments
 * without Pi can keep using LegacyGradingRuntime. Install
 * @earendil-works/pi-coding-agent before enabling PI_RUNTIME=pi.
 */
export class PiGradingRuntime implements GradingRuntime {
  private readonly sessions = new Map<string, any>();

  async run(context: RuntimeRunContext, prompt: string, images: RuntimeImage[] = context.images || []): Promise<string> {
    if (images.length > 0 && context.model.supportsImages === false) {
      throw new Error(`模型 ${context.model.id} 未开启图片输入，拒绝退化为纯文本评分`);
    }
    validateInlineImageLimits(images);
    const sdk = await loadPiSdk();
    const modelRuntime = await sdk.ModelRuntime.create({ allowModelNetwork: true });
    ensureDeepSeekFlashModel(modelRuntime, context.model.provider, context.model.id);
    const model = modelRuntime.getModel(context.model.provider, context.model.id);
    if (!model) {
      const available = modelRuntime.getModels(context.model.provider).map((item: any) => item.id);
      throw new Error(
        `Pi model not found: ${context.model.provider}/${context.model.id}. ` +
        `Available models: ${available.join(", ") || "none"}. ` +
        `请检查 PI_MODEL_PROVIDER 和 PI_MODEL_ID。`,
      );
    }
    if (images.length > 0 && !model.input.includes("image")) {
      throw new Error(`Pi model ${model.provider}/${model.id} 不支持图片输入，拒绝退化为纯文本分析`);
    }
    if (context.model.apiKey) await modelRuntime.setRuntimeApiKey(model.provider, context.model.apiKey);

    // Vision extraction is a structured, non-thinking request. The explicit
    // sampling override guarantees DeepSeek receives `thinking: { type: "disabled" }`.
    const requestModel = images.length > 0
      ? {
        ...model,
        samplingParams: {
          ...(model.samplingParams || {}),
          temperature: 0.2,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
        },
      }
      : model;
    const { session } = await sdk.createAgentSession({
      model: requestModel,
      modelRuntime,
      sessionManager: sdk.SessionManager.inMemory(),
      thinkingLevel: images.length > 0 ? "off" : undefined,
      noTools: "all",
    });
    this.sessions.set(context.runId, session);
    try {
      await session.prompt(`${context.systemPrompt}\n\n${prompt}`, images.length > 0 ? {
        // Pi's ImageContent is `{ type, data, mimeType }`. The Pi OpenAI
        // adapter converts it to DeepSeek's `image_url` data URL format.
        images: images.map((image) => ({
          type: "image",
          data: image.data,
          mimeType: image.mediaType,
        }))
      } : undefined);
      const messages = session.messages || [];
      const last = [...messages].reverse().find((message: any) => message.role === "assistant");
      return typeof last?.content === "string"
        ? last.content
        : (last?.content || []).map((item: any) => item.text || "").join("\n");
    } finally {
      this.sessions.delete(context.runId);
      session.dispose?.();
    }
  }

  async abort(runId: string): Promise<void> {
    await this.sessions.get(runId)?.abort?.();
    this.sessions.delete(runId);
  }
}

async function loadPiSdk(): Promise<any> {
  const loader = Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
  try {
    return await loader("@earendil-works/pi-coding-agent");
  } catch (error) {
    throw new Error("Pi Runtime 未安装，请在 app/agent-engine 安装 @earendil-works/pi-coding-agent 后重试");
  }
}

/**
 * DeepSeek renamed the vision model to `deepseek-flash`. Older Pi catalogs
 * still contain the retired v4 IDs, so register the official name as a local
 * compatibility alias while preserving Pi's native OpenAI transport/auth.
 */
function validateInlineImageLimits(images: RuntimeImage[]): void {
  const maxSingleBytes = 32 * 1024 * 1024;
  // Keep the encoded image payload below DeepSeek's 48 MiB request limit and
  // leave room for the prompt, JSON envelope, and authorization metadata.
  const maxTotalBytes = 35 * 1024 * 1024;
  let totalBytes = 0;
  for (const image of images) {
    const bytes = Math.floor(image.data.length * 3 / 4);
    if (bytes > maxSingleBytes) {
      throw new Error(`图片 ${image.filename || ""} 超过 DeepSeek 内联图片 32 MiB 限制，请压缩图片后重试`);
    }
    totalBytes += bytes;
  }
  if (totalBytes > maxTotalBytes) {
    throw new Error("本次图片总量过大，超过 DeepSeek 内联请求安全上限，请减少图片或压缩后重试");
  }
}

function ensureDeepSeekFlashModel(modelRuntime: any, provider: string, modelId: string): void {
  if (provider !== "deepseek" || modelId !== "deepseek-flash" || modelRuntime.getModel(provider, modelId)) {
    return;
  }

  const catalogModels = modelRuntime.getModels(provider) || [];
  const visionModel = catalogModels.find((model: any) => model.input?.includes("image")) || {
    id: "deepseek-flash",
    name: "DeepSeek Flash",
    api: "openai-completions",
    baseUrl: "https://api.deepseek.com",
    provider,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 32_768,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
    },
    thinkingLevelMap: { minimal: null, low: "low", medium: null, high: "high", max: "max" },
  };

  const definitions = catalogModels.map(({ provider: _provider, headers: _headers, ...model }: any) => model);
  definitions.push({
    ...visionModel,
    id: "deepseek-flash",
    name: "DeepSeek Flash",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 32_768,
  });
  modelRuntime.registerProvider(provider, { models: definitions });
}
