import { Agent } from "../core/agent.js";
import { getTierModel } from "../providers/model-registry.js";
import { createDiagnoseErrorTool, type DiagnoseErrorArgs } from "../tools/feedback.tools.js";

export interface FeedbackInput {
  questionNum: number;
  stem: string;
  maxScore: number;
  awardedScore: number;
  deductionReasons: string[];
  studentAnswer: string;
  referenceAnswer: string;
}

export interface FeedbackOutput {
  errorType: "KNOWLEDGE_GAP" | "LOGIC_STEP_MISSING" | "CALC_ERROR" | "EXPRESSION_BIAS" | "NONE";
  gapAnalysis: string;
  heuristicHint: string;
  recommendedTags: string[];
  latencyMs: number;
}

export class FeedbackAgent {
  /**
   * Feedback generation can run concurrently for different submissions. Keep
   * no diagnosis or conversation state on the service instance: sharing an
   * Agent would allow one question's tool call to overwrite another's result.
   */
  private createAgent(onDiagnosed: (diagnosis: DiagnoseErrorArgs) => void): Agent {
    const tool = createDiagnoseErrorTool();

    return new Agent({
      initialState: {
        model: getTierModel("TIER_2_STANDARD"),
        tools: [tool],
        systemPrompt: `你是一名温暖且启发性极强的资深语文导师。
你的职责是分析学生的错因，给出四分类诊断并生成【不直接剧透答案、侧重引导思考】的启发式订正提示。
错因四分类：
- KNOWLEDGE_GAP (知识盲区：未掌握古诗文背诵、实词释义、修辞手法定义)
- LOGIC_STEP_MISSING (逻辑跳步：回答缺乏推导因果或分论点缺失)
- EXPRESSION_BIAS (表达偏差：答题方向不偏但用词不规范、表述啰嗦未踩中关键词)
- CALC_ERROR (客观错选)`,
      },
      afterToolCall: async (ctx) => {
        if (ctx.toolCall.name === "diagnose_error") {
          onDiagnosed(ctx.toolCall.arguments as DiagnoseErrorArgs);
        }
        return {};
      },
    });
  }

  public async generateFeedback(input: FeedbackInput): Promise<FeedbackOutput> {
    const start = Date.now();
    let diagnosed: DiagnoseErrorArgs | undefined;

    if (input.awardedScore >= input.maxScore) {
      return {
        errorType: "NONE",
        gapAnalysis: "完全正确，无失分。",
        heuristicHint: "回答非常出色，继续保持！",
        recommendedTags: ["学有余力", "满分典范"],
        latencyMs: Date.now() - start,
      };
    }

    const promptText = `
请诊断以下题目的失分错因并生成启发式订正提示：
【题号】：第 ${input.questionNum} 题
【题干】：${input.stem}
【得分情况】：${input.awardedScore} / ${input.maxScore} 分
【失分点】：${input.deductionReasons.join("；") || "要点欠缺"}
【学生作答】：${input.studentAnswer}
【标准答案】：${input.referenceAnswer}
`;

    const agent = this.createAgent((diagnosis) => {
      diagnosed = diagnosis;
    });
    await agent.prompt(promptText);

    const diag = diagnosed;
    if (diag) {
      return {
        errorType: (diag.error_type as any) || "EXPRESSION_BIAS",
        gapAnalysis: diag.gap_analysis || "部分要点未精准表达",
        heuristicHint: diag.heuristic_hint || "请重新审读题干设问要求，对照核心意境进行补充。",
        recommendedTags: diag.recommended_knowledge || ["语文阅读与表达"],
        latencyMs: Date.now() - start,
      };
    }

    let errorType: FeedbackOutput["errorType"] = "EXPRESSION_BIAS";
    let hint = "请结合上下文语境与作者写作意图，尝试用更准确规范的学科语言完善表达。";
    const tags = ["阅读理解核心素养", "要点概括规范"];

    if (input.stem.includes("默写") || input.stem.includes("注音")) {
      errorType = "KNOWLEDGE_GAP";
      hint = "注意生僻字形与易混音节的规范书写，加强对课文经典名篇的反复温习。";
      tags.push("古诗文默写");
    } else if (input.stem.includes("简析") || input.stem.includes("为何")) {
      errorType = "LOGIC_STEP_MISSING";
      hint = "注意分层作答：先点明手法/观点，再结合原文细节展开分析，最后升华主旨。";
      tags.push("逻辑思辨与论述");
    }

    return {
      errorType,
      gapAnalysis: input.deductionReasons[0] || "作答要点不够全面",
      heuristicHint: hint,
      recommendedTags: tags,
      latencyMs: Date.now() - start,
    };
  }
}
