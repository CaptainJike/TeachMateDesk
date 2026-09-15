import { Agent } from "../core/agent.js";
import { getTierModel } from "../providers/model-registry.js";
import { createExtractQuestionsTool, type ExtractQuestionsArgs } from "../tools/parser.tools.js";

export interface ParsedQuestion {
  num: number;
  sub_num?: string;
  type: string;
  sub_type?: string;
  difficulty?: "easy" | "medium" | "hard";
  section_title?: string;
  stem: string;
  options?: string[];
  /** 原卷明确标注的分值；未标注时为 null，交由程序自动配分。 */
  score: number | null;
  /** 分值来源：original=原卷明确，ai=AI 推测，auto=程序自动，manual=教师手工。 */
  score_source?: "original" | "ai" | "auto" | "manual" | null;
}

export interface QuestionParserOutput {
  examTitle: string;
  questions: ParsedQuestion[];
  totalScore: number;
  latencyMs: number;
}

export class QuestionParserAgent {
  private agent: Agent;
  private parsedResult: ParsedQuestion[] = [];
  private examTitle = "";

  constructor() {
    const model = getTierModel("TIER_1_FAST");
    const extractTool = createExtractQuestionsTool();

    this.agent = new Agent({
      initialState: {
        model,
        tools: [extractTool],
        systemPrompt: `你是一名经验丰富的试卷切题与实体抽取 Agent。
你的任务是将结构化试卷文本拆解为标准题目实体列表。每一个独立作答且独立计分的题目/小题都必须输出一条实体；不要把同一大题下的（1）（2）合并。num 填所属大题号，sub_num 填完整层级编号，例如第 5 大题第 1 小题的两个问分别为 5.1.1、5.1.2；只有一层小题时使用 1.1、1.2。不要重复拼接已经包含大题号的 sub_num。
section_title 填写该题所属大题标题（如"四、计算题"），sub_type 填写细分题型（如 oral_calculation、vertical_calculation、equation）。
关于分值：请优先识别试卷中原有的分数信息（每题X分、共X分、括号中的分值如（5分）、题目末尾分值）。
若原卷没有明确标注分值，score 必须返回 null、score_source 返回 null，不要凭经验猜测；系统会统一自动配分。
若原卷明确写出了分值，score 返回该分值且 score_source 返回 "original"；若为你的推断，score_source 返回 "ai"。
必须调用 \`extract_questions\` 工具输出切分结果。`,
      },
      afterToolCall: async (ctx) => {
        if (ctx.toolCall.name === "extract_questions") {
          const args = ctx.toolCall.arguments as ExtractQuestionsArgs;
          this.examTitle = args.exam_title;
          this.parsedResult = (args.questions || []).map((question) => ({
            num: question.num,
            sub_num: question.sub_num,
            type: question.type,
            sub_type: question.sub_type,
            difficulty: normalizeDifficulty(question.difficulty),
            section_title: question.section_title,
            stem: question.stem,
            options: question.options,
            score: normalizeScore(question.score),
            score_source: normalizeScoreSource(question.score_source, question.score),
          }));
        }
        return {};
      },
    });
  }

  public async parseQuestions(markdownText: string, defaultTitle = "语文测试卷"): Promise<QuestionParserOutput> {
    const start = Date.now();
    this.parsedResult = [];
    this.examTitle = defaultTitle;

    await this.agent.prompt(`请解析切分以下试卷内容：\n\n${markdownText}`);

    if (this.parsedResult.length === 0) {
      this.parsedResult = this.heuristicParse(markdownText);
    }

    const totalScore = this.parsedResult.reduce((sum, q) => sum + (Number(q.score) || 0), 0);
    const latencyMs = Date.now() - start;

    return {
      examTitle: this.examTitle || defaultTitle,
      questions: this.parsedResult,
      totalScore,
      latencyMs,
    };
  }

  private heuristicParse(text: string): ParsedQuestion[] {
    const questions: ParsedQuestion[] = [];
    const lines = text.split("\n");
    let currentQ: Partial<ParsedQuestion> | null = null;
    let qNum = 0;

    for (const line of lines) {
      const qMatch = line.match(/^(\d+)[\.、\s](.*)/);
      if (qMatch) {
        if (currentQ && currentQ.stem) {
          questions.push(currentQ as ParsedQuestion);
        }
        qNum = parseInt(qMatch[1], 10);
        const rest = qMatch[2].trim();
        // 降级解析也要保留原卷明确的单题分值。小学试卷常见写法除了
        // “（2分）”外，还包括“每题2分”；后者不能交给自动配分引擎重算。
        const scoreMatch = line.match(/[\(（](\d+(?:\.\d+)?)\s*分[\)）]/)
          || line.match(/每题\s*(\d+(?:\.\d+)?)\s*分/);
        const isChoice = rest.includes("A.") || rest.includes("A．") || line.includes("( )");

        currentQ = {
          num: qNum,
          type: isChoice ? "single_choice" : "subjective_short",
          stem: line,
          score: scoreMatch ? parseFloat(scoreMatch[1]) : null,
          score_source: scoreMatch ? "original" : null,
          options: isChoice ? ["A. 选项1", "B. 选项2", "C. 选项3", "D. 选项4"] : undefined,
        };
      } else if (currentQ) {
        currentQ.stem = `${currentQ.stem}\n${line}`;
      }
    }

    if (currentQ && currentQ.stem) {
      questions.push(currentQ as ParsedQuestion);
    }

    if (questions.length === 0) {
      questions.push({
        num: 1,
        type: "subjective_short",
        stem: text,
        score: null,
        score_source: null,
      });
    }

    return questions;
  }
}

function normalizeScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeScoreSource(
  value: unknown,
  rawScore: unknown,
): "original" | "ai" | "auto" | "manual" | null {
  const score = normalizeScore(rawScore);
  if (score === null) return null;
  const source = String(value ?? "").trim().toLowerCase();
  if (source === "original") return "original";
  if (source === "ai") return "ai";
  return "ai";
}

function normalizeDifficulty(value: unknown): "easy" | "medium" | "hard" | undefined {
  const difficulty = String(value ?? "").trim().toLowerCase();
  return ["easy", "medium", "hard"].includes(difficulty)
    ? (difficulty as "easy" | "medium" | "hard")
    : undefined;
}
