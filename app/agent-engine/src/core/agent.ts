import { EventEmitter } from "events";
import { LlmLogger } from "./llm-logger.js";
import type {
  AgentMessage,
  AgentState,
  AgentTool,
  AgentEvent,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
  AfterToolCallResult,
  ModelInfo,
} from "./types.js";

export interface AgentInitOptions {
  initialState: {
    model: ModelInfo;
    tools?: AgentTool<any>[];
    systemPrompt?: string;
    messages?: AgentMessage[];
  };
  responseFormat?: { type: "json_object" | "text"; json_schema?: unknown };
  beforeToolCall?: (ctx: BeforeToolCallContext) => Promise<BeforeToolCallResult>;
  afterToolCall?: (ctx: AfterToolCallContext) => Promise<AfterToolCallResult>;
}

export class Agent extends EventEmitter {
  public state: AgentState;
  private beforeToolCall?: (ctx: BeforeToolCallContext) => Promise<BeforeToolCallResult>;
  private afterToolCall?: (ctx: AfterToolCallContext) => Promise<AfterToolCallResult>;
  private responseFormat?: AgentInitOptions["responseFormat"];

  constructor(options: AgentInitOptions) {
    super();
    this.state = {
      model: options.initialState.model,
      tools: options.initialState.tools || [],
      systemPrompt: options.initialState.systemPrompt || "",
      messages: options.initialState.messages || [],
    };
    this.beforeToolCall = options.beforeToolCall;
    this.afterToolCall = options.afterToolCall;
    this.responseFormat = options.responseFormat;
  }

  public setSystemPrompt(prompt: string): void {
    this.state.systemPrompt = prompt;
  }

  public addTool(tool: AgentTool<any>): void {
    this.state.tools.push(tool);
  }

  public async prompt(
    userText: string,
    images: Array<{ mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string }> = [],
  ): Promise<string> {
    if (images.length > 0 && this.state.model.supportsImages === false) {
      throw new Error(`模型 ${this.state.model.id} 未开启图片输入，拒绝退化为纯文本评分`);
    }
    this.state.messages.push({
      role: "user",
      content: [
        { type: "text", text: userText },
        ...images.map((image) => ({
          type: "image" as const,
          source: { type: "base64" as const, mediaType: image.mediaType, data: image.data },
        })),
      ],
    });

    this.emit("event", { type: "start", data: { model: this.state.model.name } } as AgentEvent);

    let maxTurns = 6;
    let turn = 0;
    let finalAssistantText = "";

    while (turn < maxTurns) {
      turn++;
      const response = await this.invokeModel();

      if (response.toolCalls && response.toolCalls.length > 0) {
        // Record Assistant Message containing tool calls
        this.state.messages.push({
          role: "assistant",
          content: response.text || "",
          ...(response.reasoningContent ? { reasoningContent: response.reasoningContent } : {}),
          toolCalls: response.toolCalls,
        } as any);

        // Execute tool calls
        for (const tc of response.toolCalls) {
          this.emit("event", {
            type: "tool_call_start",
            data: { tool: tc.name, args: tc.arguments },
          } as AgentEvent);

          // 1. Before Tool Call Hook
          if (this.beforeToolCall) {
            const beforeRes = await this.beforeToolCall({
              toolCall: tc,
              args: tc.arguments,
            });
            if (beforeRes.block) {
              this.emit("event", {
                type: "error",
                data: { reason: beforeRes.reason || "Tool execution blocked" },
              } as AgentEvent);
              continue;
            }
            if (beforeRes.modifiedArgs) {
              tc.arguments = beforeRes.modifiedArgs;
            }
          }

          const targetTool = this.state.tools.find((t) => t.name === tc.name);
          let toolResult: { content: Array<{ type: "text"; text: string }>; details?: any };

          if (targetTool) {
            try {
              toolResult = await targetTool.execute(tc.arguments);
            } catch (err: any) {
              toolResult = {
                content: [{ type: "text", text: `Error executing tool ${tc.name}: ${err.message}` }],
              };
            }
          } else {
            toolResult = {
              content: [{ type: "text", text: `Tool ${tc.name} not found.` }],
            };
          }

          // 2. After Tool Call Hook
          if (this.afterToolCall) {
            await this.afterToolCall({
              toolCall: tc,
              result: toolResult,
            });
          }

          this.emit("event", {
            type: "tool_call_end",
            data: { tool: tc.name, result: toolResult },
          } as AgentEvent);

          const resultText = toolResult.content.map((c) => c.text).join("\n") || "Success";

          this.state.messages.push({
            role: "toolResult",
            toolCallId: tc.id,
            content: resultText,
          } as any);
        }
      } else {
        finalAssistantText = response.text || "";
        this.state.messages.push({
          role: "assistant",
          content: [{ type: "text", text: finalAssistantText }],
        });
        break;
      }
    }

    this.emit("event", { type: "done", data: { text: finalAssistantText } } as AgentEvent);
    return finalAssistantText;
  }

  private async invokeModel(): Promise<{
    text?: string;
    reasoningContent?: string;
    toolCalls?: Array<{ id: string; name: string; arguments: any }>;
  }> {
    // Read the single configured Pi model key at run time.
    const effectiveApiKey =
      this.state.model.apiKey ||
      process.env.PI_MODEL_API_KEY ||
      "";

    if (!effectiveApiKey) {
      throw new Error(
        `【未配置多模态模型 API Key】请在 app/.env 中配置 PI_MODEL_API_KEY。`
      );
    }

    this.state.model.apiKey = effectiveApiKey;

    // 动态同步 BaseUrl
    if (!this.state.model.baseUrl || this.state.model.baseUrl === "https://api.deepseek.com") {
      this.state.model.baseUrl = process.env.PI_MODEL_BASE_URL || "https://api.deepseek.com";
    }

    return await this.callRemoteLlm();
  }

  private async callRemoteLlm(): Promise<{
    text?: string;
    reasoningContent?: string;
    toolCalls?: Array<{ id: string; name: string; arguments: any }>;
  }> {
    const model = this.state.model;
    let url: string = (model.baseUrl || process.env.OPENAI_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
    if (!url.endsWith("/chat/completions")) {
      url = `${url}/chat/completions`;
    }

    const openAiTools = this.state.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const messages = [
      { role: "system", content: this.state.systemPrompt },
      ...this.state.messages.map((m: any) => {
        if (m.role === "toolResult") {
          return {
            role: "tool",
            tool_call_id: m.toolCallId || "call_default",
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          };
        }
        if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: "assistant",
            content: m.content || null,
            ...(m.reasoningContent ? { reasoning_content: m.reasoningContent } : {}),
            tool_calls: m.toolCalls.map((tc: any) => ({
              id: tc.id,
              type: "function",
              function: {
                name: tc.name,
                arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
              },
            })),
          };
        }
        if (typeof m.content === "string") {
          return { role: m.role, content: m.content };
        }
        if (Array.isArray(m.content)) {
          return {
            role: m.role,
            content: m.content.map((c: any) => {
              if (c.type === "image") {
                return {
                  type: "image_url",
                  image_url: { url: `data:${c.source.mediaType};base64,${c.source.data}` },
                };
              }
              return { type: "text", text: c.text || JSON.stringify(c) };
            }),
          };
        }
        return { role: m.role, content: m.content };
      }),
    ];

    const auditMessages = redactAuditMessages(messages);
    const isDeepSeek = model.provider === "deepseek" || url.includes("api.deepseek.com");
    const jsonOutput = this.responseFormat?.type === "json_object";
    const body: any = {
      model: model.id,
      messages,
      max_tokens: model.maxTokens,
    };
    if (isDeepSeek) {
      if (jsonOutput) {
        // JSON extraction should be deterministic and does not need a
        // reasoning trace; this is the documented DeepSeek switch.
        body.thinking = { type: "disabled" };
        body.temperature = 0.2;
      } else {
        // Text grading benefits from DeepSeek's reasoning mode. The model
        // returns reasoning_content, which this Agent replays on tool turns.
        const reasoningEffort = process.env.PI_MODEL_REASONING_EFFORT || "high";
        if (reasoningEffort === "none") {
          body.thinking = { type: "disabled" };
          body.temperature = 0.2;
        } else {
          body.thinking = { type: "enabled" };
          body.reasoning_effort = reasoningEffort;
        }
      }
    } else {
      body.temperature = 0.2;
    }
    if (openAiTools.length > 0) {
      body.tools = openAiTools;
    }
    if (this.responseFormat?.type === "json_object") {
      body.response_format = this.responseFormat.json_schema
        ? { type: "json_schema", json_schema: this.responseFormat.json_schema }
        : { type: "json_object" };
    }

    const startTime = Date.now();
    const lastUserPrompt = messages.filter((m) => m.role === "user").slice(-1)[0]?.content || "";
    console.log(
      `\x1b[36m[LLM Request]\x1b[0m 🚀 \x1b[1m${model.name}\x1b[0m (\x1b[33m${model.id}\x1b[0m) -> ${url}`
    );
    if (typeof lastUserPrompt === "string" && lastUserPrompt.length > 0) {
      console.log(`\x1b[90m  └─ Prompt Snippet: ${lastUserPrompt.slice(0, 120).replace(/\n/g, " ")}...\x1b[0m`);
    }

    let res: globalThis.Response;
    const timeoutMs = Math.max(1_000, Number(process.env.PI_MODEL_TIMEOUT_MS) || 180_000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${model.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeout);
      const latency = Date.now() - startTime;
      console.error(`\x1b[31m[LLM Network Error]\x1b[0m ❌ ${err.message}`);
      LlmLogger.logInteraction({
        modelName: model.name,
        modelId: model.id,
        url,
        messages: auditMessages,
        tools: openAiTools,
        error: `Network Error: ${err.message}`,
        latencyMs: latency,
      });
      throw new Error(`无法连接至大模型接口 (${url}): ${err.message}`);
    }
    clearTimeout(timeout);

    const latency = Date.now() - startTime;

    if (!res.ok) {
      const errText = await res.text();
      console.error(
        `\x1b[31m[LLM Error HTTP ${res.status}]\x1b[0m ❌ ${errText} (耗时: ${latency}ms)`
      );
      LlmLogger.logInteraction({
        modelName: model.name,
        modelId: model.id,
        url,
        messages: auditMessages,
        tools: openAiTools,
        error: `HTTP ${res.status}: ${errText}`,
        latencyMs: latency,
        httpStatus: res.status,
      });
      throw new Error(`LLM 接口返回 HTTP ${res.status}: ${errText}`);
    }

    const json = (await res.json()) as any;
    const choice = json.choices?.[0]?.message;
    if (!choice) {
      LlmLogger.logInteraction({
        modelName: model.name,
        modelId: model.id,
        url,
        messages: auditMessages,
        tools: openAiTools,
        error: "Empty LLM choices response",
        latencyMs: latency,
        httpStatus: res.status,
      });
      throw new Error("Empty LLM response");
    }

    const toolCalls = choice.tool_calls?.map((tc: any) => ({
      id: tc.id || `call_${Date.now()}`,
      name: tc.function.name,
      arguments: parseToolArguments(tc.function.arguments),
    }));

    // 写入本地 LLM 独立日志文件 (app/logs/llm_interactions.log)
    LlmLogger.logInteraction({
      modelName: model.name,
      modelId: model.id,
      url,
      messages: auditMessages,
      tools: openAiTools,
      response: {
        text: choice.content || "",
        toolCalls,
        rawJson: json,
      },
      latencyMs: latency,
      httpStatus: res.status,
    });

    if (toolCalls && toolCalls.length > 0) {
      console.log(
        `\x1b[32m[LLM Response]\x1b[0m ✨ \x1b[1mTool Calls (${toolCalls.length}):\x1b[0m ${toolCalls.map((t: any) => t.name).join(", ")} \x1b[90m(${latency}ms)\x1b[0m`
      );
    } else {
      console.log(
        `\x1b[32m[LLM Response]\x1b[0m ✨ \x1b[90m${(choice.content || "").slice(0, 100).replace(/\n/g, " ")}... (${latency}ms)\x1b[0m`
      );
    }

    return {
      text: choice.content || "",
      reasoningContent: choice.reasoning_content || choice.reasoningContent || "",
      toolCalls,
    };
  }

  private async simulateReasoning(): Promise<{
    text?: string;
    toolCalls?: Array<{ id: string; name: string; arguments: any }>;
  }> {
    const lastUserMsg = [...this.state.messages].reverse().find((m) => m.role === "user");
    const lastUserText = typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : ((lastUserMsg?.content?.[0] as any)?.text || "");

    const toolResultCount = this.state.messages.filter((m) => m.role === "toolResult").length;

    if (this.state.tools.length > 0 && toolResultCount === 0) {
      const verifyTool = this.state.tools.find((t) => t.name === "verify_step_score");
      if (verifyTool && (lastUserText.includes("rubricSteps") || lastUserText.includes("分步采分细则"))) {
        try {
          const rubricMatch = lastUserText.match(/\[\s*\{[\s\S]*?\}\s*\]/);
          let steps: any[] = [];
          if (rubricMatch) {
            steps = JSON.parse(rubricMatch[0]);
          }

          if (steps.length > 0) {
            const studentMatch = lastUserText.match(/【学生实际作答】[\s\S]*?"""([\s\S]*?)"""/);
            const studentAns = studentMatch ? studentMatch[1].trim() : "";

            const calls = steps.map((step: any) => {
              const hasKeyword = step.keywords && step.keywords.some((k: string) => studentAns.includes(k));
              const isHit = studentAns.length > 5 && (hasKeyword || !step.keywords || step.keywords.length === 0);
              const score = isHit ? step.score : 0;
              const evidence = isHit
                ? (studentAns.slice(0, 30) || "学生作答命中核心采分点")
                : "作答未体现该核心要点";

              return {
                id: `call_step_${step.step_no}`,
                name: "verify_step_score",
                arguments: {
                  step_no: step.step_no,
                  max_step_score: step.score,
                  awarded_score: score,
                  is_hit: isHit,
                  evidence_quote: evidence,
                  deduction_reason: isHit ? "回答准确，采分点命中" : `未完整体现【${step.criteria}】要点`,
                },
              };
            });

            return { toolCalls: calls };
          }
        } catch {
          // fallback
        }
      }

      const rubricTool = this.state.tools.find((t) => t.name === "generate_rubric_steps");
      if (rubricTool) {
        return {
          toolCalls: [
            {
              id: "call_rubric_1",
              name: "generate_rubric_steps",
              arguments: {
                question_title: "主观阅读简答题",
                max_score: 4,
                steps: [
                  {
                    step_no: 1,
                    score: 2,
                    criteria: "准确指出文章主旨与作者情感抒发的核心要点",
                    keywords: ["热爱", "抒发", "主旨"],
                  },
                  {
                    step_no: 2,
                    score: 2,
                    criteria: "结合具体语句进行修辞或手法剖析，逻辑通顺",
                    keywords: ["修辞", "衬托", "生动"],
                  },
                ],
              },
            },
          ],
        };
      }

      const extractTool = this.state.tools.find((t) => t.name === "extract_questions");
      if (extractTool) {
        return {
          toolCalls: [
            {
              id: "call_extract_1",
              name: "extract_questions",
              arguments: {
                exam_title: "初中语文期末模拟试卷",
                questions: [
                  {
                    num: 1,
                    type: "single_choice",
                    stem: "下列加点字注音完全正确的一项是 ( )",
                    options: ["A. 畸形(jī) 匿名(nì)", "B. 炽热(zhì) 诘责(jié)", "C. 禁锢(gù) 滞留(dài)", "D. 轩邈(miǎo) 经纶(lún)"],
                    score: 3,
                  },
                  {
                    num: 2,
                    type: "fill_blank",
                    stem: "默写填空：东风不与周郎便，_______________。（杜牧《赤壁》）",
                    score: 2,
                  },
                  {
                    num: 3,
                    type: "subjective_short",
                    stem: "简析文中划线句子运用了何种修辞手法，有何表达效果？",
                    score: 4,
                  },
                ],
              },
            },
          ],
        };
      }
    }

    return {
      text: `【智能批改核验完成】：已严格对照标答与分步采分细则逐项核验。作答逻辑清晰，关键采分点匹配明确，置信度高。`,
    };
  }
}

function parseToolArguments(value: unknown): any {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return {};
  const source = value.trim().replace(/^```(?:json)?\\s*/i, "").replace(/\\s*```$/, "");
  const candidates = [source, source.slice(source.indexOf("{"), source.lastIndexOf("}") + 1)];
  for (const candidate of candidates) {
    if (!candidate || !candidate.includes("{")) continue;
    try {
      return JSON.parse(candidate);
    } catch {}
    try {
      // DeepSeek occasionally emits unescaped quotes inside evidence text.
      const repaired = candidate
        .replace(/[“”]/g, '"')
        .replace(/,\\s*([}\\]])/g, "$1")
        .replace(/\\\\n/g, "\\n");
      return JSON.parse(repairQuotedJson(repaired));
    } catch {}
  }
  throw new Error(`模型 Tool Call 参数不是合法 JSON: ${source.slice(0, 300)}`);
}

function repairQuotedJson(value: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "\\" && !escaped) {
      escaped = true;
      result += char;
      continue;
    }
    if (char === '"' && !escaped) {
      if (inString) {
        const rest = value.slice(i + 1).match(/^\\s*([,}\\]])/);
        if (!rest) {
          result += '\\\\"';
          escaped = false;
          continue;
        }
      }
      inString = !inString;
    }
    result += char;
    escaped = false;
  }
  return result;
}

function redactAuditMessages(messages: any[]): any[] {
  return messages.map((message) => {
    const clone = { ...message };
    if (typeof clone.content === "string") {
      clone.content = clone.content
        .replace(/(【学生实际作答】\\s*["“”]*)([\\s\\S]*?)(["“”]*\\s*请对照)/g, "$1[STUDENT_ANSWER_REDACTED]$3")
        .replace(/(studentAnswer\\s*[:=]\\s*)([^,}]+)/gi, "$1[REDACTED]");
    }
    return clone;
  });
}
