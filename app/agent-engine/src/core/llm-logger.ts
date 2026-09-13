import fs from "node:fs";
import path from "node:path";

/**
 * 专门记录 Agent 与大模型 (LLM) 完整交互过程的 Logger
 * 每次服务启动生成带有时间戳的独立会话日志文件:
 * app/logs/llm_session_YYYY-MM-DD_HH-mm-ss.log 及 app/logs/llm_interactions_latest.log
 */
export class LlmLogger {
  // 记录本次进程启动时的时间戳格式化字符串 (如 2026-08-30_17-38-00)
  private static sessionStamp: string = LlmLogger.formatSessionTime(new Date());

  private static formatSessionTime(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
  }

  private static getLogDir(): string {
    let current = process.cwd();
    let appLogsDir = path.resolve(current, "logs");
    const dirName = path.basename(current);
    if (dirName === "server" || dirName === "agent-engine" || dirName === "web" || dirName === "file-server") {
      appLogsDir = path.resolve(current, "..", "logs");
    }
    if (!fs.existsSync(appLogsDir)) {
      fs.mkdirSync(appLogsDir, { recursive: true });
    }
    return appLogsDir;
  }

  public static getSessionLogFile(): string {
    const dir = this.getLogDir();
    return path.join(dir, `llm_session_${this.sessionStamp}.log`);
  }

  public static getLatestLogFile(): string {
    const dir = this.getLogDir();
    return path.join(dir, "llm_interactions_latest.log");
  }

  public static logInteraction(entry: {
    modelName: string;
    modelId: string;
    url: string;
    systemPrompt?: string;
    messages: any[];
    tools?: any[];
    response?: {
      text?: string;
      toolCalls?: Array<{ id: string; name: string; arguments: any }>;
      rawJson?: any;
    };
    error?: string;
    latencyMs: number;
    httpStatus?: number;
  }) {
    const timestamp = new Date().toISOString();
    const divider = "=".repeat(90);
    const subDivider = "-".repeat(90);

    const logLines: string[] = [
      divider,
      `[TIMESTAMP]  : ${timestamp}`,
      `[MODEL]      : ${entry.modelName} (ID: ${entry.modelId})`,
      `[ENDPOINT]   : ${entry.url}`,
      `[LATENCY]    : ${entry.latencyMs} ms | STATUS: ${entry.httpStatus || (entry.error ? "ERROR" : "OK")}`,
      subDivider,
      `>>> [REQUEST MESSAGES] (${entry.messages.length} messages):`,
    ];

    entry.messages.forEach((msg, idx) => {
      const role = String(msg.role || "").toUpperCase();
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content, null, 2);
      logLines.push(`  [Message ${idx + 1} | Role: ${role}]:\n${content}\n`);
    });

    if (entry.tools && entry.tools.length > 0) {
      logLines.push(`>>> [AVAILABLE TOOLS] (${entry.tools.length}):`);
      logLines.push(JSON.stringify(entry.tools.map((t) => t.function?.name || t.name), null, 2));
    }

    logLines.push(subDivider);

    if (entry.error) {
      logLines.push(`<<< [ERROR RESPONSE]:`);
      logLines.push(entry.error);
    } else if (entry.response) {
      logLines.push(`<<< [LLM RESPONSE]:`);
      if (entry.response.text) {
        logLines.push(`[Text Content]:\n${entry.response.text}\n`);
      }
      if (entry.response.toolCalls && entry.response.toolCalls.length > 0) {
        logLines.push(`[Tool Calls (${entry.response.toolCalls.length})]:`);
        logLines.push(JSON.stringify(entry.response.toolCalls, null, 2));
      }
      if (entry.response.rawJson?.usage) {
        logLines.push(`\n[Token Usage]: ${JSON.stringify(entry.response.rawJson.usage)}`);
      }
    }

    logLines.push(divider);
    logLines.push("\n\n");

    const fullLog = logLines.join("\n");
    const sessionLogFile = this.getSessionLogFile();
    const latestLogFile = this.getLatestLogFile();

    try {
      // 同时追加写入本次启动的专属时间戳日志与最新日志
      fs.appendFileSync(sessionLogFile, fullLog, "utf8");
      fs.appendFileSync(latestLogFile, fullLog, "utf8");
    } catch (e: any) {
      console.warn(`[LlmLogger] Write error: ${e.message}`);
    }
  }
}
