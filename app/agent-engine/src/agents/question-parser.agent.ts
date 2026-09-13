import { Agent } from "../core/agent.js";
import { getTierModel } from "../providers/model-registry.js";
import { createExtractQuestionsTool, type ExtractQuestionsArgs } from "../tools/parser.tools.js";

export interface ParsedQuestion {
  num: number;
  sub_num?: string;
  type: string;
  stem: string;
  options?: string[];
  score: number;
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
必须调用 \`extract_questions\` 工具输出切分结果。`,
      },
      afterToolCall: async (ctx) => {
        if (ctx.toolCall.name === "extract_questions") {
          const args = ctx.toolCall.arguments as ExtractQuestionsArgs;
          this.examTitle = args.exam_title;
          this.parsedResult = args.questions;
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

    const totalScore = this.parsedResult.reduce((sum, q) => sum + (q.score || 0), 0);
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
        const scoreMatch = line.match(/[\(（](\d+)分[\)）]/);
        const score = scoreMatch ? parseFloat(scoreMatch[1]) : 3;
        const isChoice = rest.includes("A.") || rest.includes("A．") || line.includes("( )");

        currentQ = {
          num: qNum,
          type: isChoice ? "single_choice" : "subjective_short",
          stem: line,
          score,
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
        score: 10,
      });
    }

    return questions;
  }
}
