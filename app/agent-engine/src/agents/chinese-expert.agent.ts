import { Agent } from "../core/agent.js";
import { getTierModel, type ModelTier } from "../providers/model-registry.js";
import {
  createVerifyStepScoreTool,
  createCompareObjectiveTool,
  type VerifyStepScoreArgs,
} from "../tools/grading.tools.js";
import { createQueryTextbookKnowledgeTool } from "../tools/knowledge-rag.tools.js";
import { FileBasedRetriever } from "../retriever/file-based-retriever.js";
import type { SchoolStage } from "./router.agent.js";
import type { RubricStep } from "./rubric.agent.js";
import type { RuntimeImage } from "../runtime/grading-runtime.js";
import { inferSingleChoiceAnswer } from "./objective-answer.js";

export interface ChineseGradingInput {
  questionId?: string;
  questionTitle: string;
  questionType?: string;
  options?: string[];
  stem: string;
  maxScore: number;
  rubricSteps?: RubricStep[];
  referenceAnswer: string;
  studentAnswer: string;
  school_stage?: SchoolStage;
  model_tier?: ModelTier;
  standardAnswerTeacherEdited?: boolean;
  images?: RuntimeImage[];
  answerEvidence?: string;
  /** Revision answers demonstrate learning; assess the corrected reasoning holistically. */
  isRevision?: boolean;
  previousScore?: number;
  previousFeedback?: string;
  previousAnswerEvidence?: string;
}

export interface StepGradingResult {
  step_no: number;
  score: number;
  max_score: number;
  is_hit: boolean;
  evidence: string;
  reason?: string;
}

export interface ChineseGradingOutput {
  totalAwardedScore: number;
  maxScore: number;
  confidence: number;
  /** True when the result must be reviewed before becoming final. */
  reviewRequired?: boolean;
  stepEvaluations: StepGradingResult[];
  overallSummary: string;
  modelUsed: string;
  latencyMs: number;
}

export class ChineseExpertAgent {
  private agent: Agent;
  private verifiedSteps: Map<number, StepGradingResult> = new Map();
  private modelName: string;
  private retriever: FileBasedRetriever;

  constructor(
    retriever?: FileBasedRetriever,
    stage: SchoolStage = "MIDDLE",
    tier: ModelTier = "TIER_2_STANDARD"
  ) {
    this.retriever = retriever || new FileBasedRetriever();
    const verifyTool = createVerifyStepScoreTool();
    const compareTool = createCompareObjectiveTool();
    const ragTool = createQueryTextbookKnowledgeTool(this.retriever);
    const model = getTierModel(tier);
    this.modelName = model.id;

    const stageGuidance = {
      PRIMARY: "【小学段要求】：格外关注字词拼写、标点符号及语句通顺度，采分点从严核验错别字扣分；",
      MIDDLE: "【初中段要求】：重点核验课内文言实词虚词准确度、现代文要点概括完整性与修辞手法；",
      HIGH: "【高中段要求】：重点考察文意深度意境、虚词通假辨析、论述逻辑思辨性与批判性思维深度。",
    }[stage];

    this.agent = new Agent({
      initialState: {
        model,
        tools: [verifyTool, compareTool, ragTool],
        systemPrompt: `你是一名严谨、公正的中学资深语文教师智能批改专家。
当前批改学段设定为：${stage}。
${stageGuidance}

你的任务是对学生的语文作答，严格对照【标准答案】和【分步采分细则 (Rubric)】进行逐项客观判分与证据核验。

批改准则：
1. 若为客观选择题/判断题，调用 \`compare_objective\` 工具快速比对；
2. 若为主观题，必须逐一调用 \`verify_step_score\` 工具核验每一个步骤，严禁随意给分；
3. 依据语义对齐而非死板字面匹配，只要学生表达的核心思想符合 criteria 即可判命中；
4. 必须在 evidence_quote 中提供学生答卷中的具体句子或词语作为硬证据；
5. 核验完所有步骤后，输出一段简明中肯的综合评语。`,
      },
      beforeToolCall: async (ctx) => {
        if (ctx.toolCall.name === "verify_step_score") {
          const args = ctx.args as VerifyStepScoreArgs;
          if (args.awarded_score < 0 || args.awarded_score > args.max_step_score) {
            return {
              block: true,
              reason: `步骤得分 ${args.awarded_score} 超出满分范围 [0, ${args.max_step_score}]，已安全拦截。`,
            };
          }
        }
        return {};
      },
      afterToolCall: async (ctx) => {
        if (ctx.toolCall.name === "verify_step_score" && ctx.result.details) {
          const details = ctx.result.details as StepGradingResult;
          this.verifiedSteps.set(details.step_no, details);
        }
        return {};
      },
    });
  }

  public async gradeQuestion(input: ChineseGradingInput): Promise<ChineseGradingOutput> {
    this.verifiedSteps.clear();
    const startTime = Date.now();

    const isObjective =
      input.questionType === "single_choice" ||
      input.questionType === "multi_choice" ||
      input.questionType === "judge" ||
      input.questionType === "SINGLE_CHOICE" ||
      input.questionType === "MULTI_CHOICE" ||
      input.questionType === "JUDGE";

    if (isObjective) {
      let std = (input.referenceAnswer || "").trim().toUpperCase();
      // Older imported exams initialized every choice answer to A. Repair that
      // placeholder at grading time when the answer was never teacher-edited.
      if (std === "A" && !input.standardAnswerTeacherEdited && input.options?.length) {
        const inferred = inferSingleChoiceAnswer(input.stem, input.options);
        if (inferred) std = inferred;
      }
      const stu = normalizeObjectiveAnswer(input.studentAnswer);
      if (!std) {
        return {
          totalAwardedScore: 0,
          maxScore: input.maxScore,
          confidence: 0.2,
          reviewRequired: true,
          stepEvaluations: [{
            step_no: 1,
            score: 0,
            max_score: input.maxScore,
            is_hit: false,
            evidence: input.studentAnswer || "学生未作答",
            reason: "未配置客观题标准答案，需教师审核后再判分。",
          }],
          overallSummary: "客观题尚未配置可核验的标准答案，请教师审核后重新批改。",
          modelUsed: this.modelName,
          latencyMs: Date.now() - startTime,
        };
      }
      const isCorrect = std === stu;
      const awarded = isCorrect ? input.maxScore : 0;
      const latencyMs = Date.now() - startTime;

      return {
        totalAwardedScore: awarded,
        maxScore: input.maxScore,
        confidence: 0.99,
        reviewRequired: false,
        stepEvaluations: [
          {
            step_no: 1,
            score: awarded,
            max_score: input.maxScore,
            is_hit: isCorrect,
            evidence: stu || "学生未作答",
            reason: isCorrect ? "选项比对正确" : `选项错误，标准答案为 ${std}，学生作为 ${stu || "空"}`,
          },
        ],
        overallSummary: isCorrect ? "选择题回答正确，满分。" : `选择题作答错误，正确答案为 ${std}。`,
        modelUsed: this.modelName,
        latencyMs,
      };
    }

    const rubricSteps = input.rubricSteps || [
      {
        step_no: 1,
        score: input.maxScore,
        criteria: "准确作答出核心要点",
        keywords: [],
      },
    ];

    const revisionGuidance = input.isRevision
      ? `
【这是二次订正，不是对原答案的机械复判】
学生本次作答是在看到失分提示后重新作答。请重点判断学生是否已经纠正原来的知识/思路错误：
- 只要核心方法、计算过程和最终结论正确，就应给满分；不要因为没有重复题目问法、缺少“答：”、括号或单位而扣分。
- 数学式中最后的数字/结果就是有效结论，例如“480+25×40=480+1000=1480（个）”已经明确回答总数，应视为完整作答。
- 只有确实错误、遗漏题目要求的独立要点，或无法确认答案时才扣分；不要沿用原评分中的表达形式缺陷。
原得分：${input.previousScore ?? "未知"}/${input.maxScore}；原反馈：${input.previousFeedback || "无"}
原答卷图像识别证据（仅作补充核验，优先看本次订正作答）：${input.previousAnswerEvidence || "无"}
`
      : "";

    const userPrompt = `
请批改以下语文主观题：${revisionGuidance}
【题目题干】：${input.stem}
【题目满分】：${input.maxScore} 分
【标准答案】：${input.referenceAnswer}
【分步采分细则】：
${JSON.stringify(rubricSteps, null, 2)}

【图片答案证据摘录】：
${input.answerEvidence || "无可用图片证据，必须降低置信度并进入复核。"}

【学生实际作答】：
"""
${input.studentAnswer}
"""

请对照分步采分细则进行逐步核验：`;

    // Image understanding is performed once by VisionAnswerAgent. Question
    // grading is a text reasoning task: replay the extracted evidence through
    // DeepSeek Tool Calls instead of sending the same original images again for
    // every question.
    await this.agent.prompt(userPrompt);
    const latencyMs = Date.now() - startTime;

    let totalScore = 0;
    const stepEvaluations: StepGradingResult[] = [];

    for (const step of rubricSteps) {
      const recorded = this.verifiedSteps.get(step.step_no);
      if (recorded) {
        totalScore += recorded.score;
        stepEvaluations.push(recorded);
      } else {
        const stuText = input.studentAnswer || "";
        const hitKeyword = step.keywords && step.keywords.length > 0
          ? step.keywords.some((k) => stuText.includes(k))
          : stuText.length >= 6;
        const isHit = stuText.trim().length > 0 && hitKeyword;
        const awarded = isHit ? step.score : 0;
        totalScore += awarded;

        stepEvaluations.push({
          step_no: step.step_no,
          score: awarded,
          max_score: step.score,
          is_hit: isHit,
          evidence: isHit ? stuText.slice(0, 40) : "作答未命中该采分点",
          reason: isHit ? "回答准确，采分点命中" : `作答中缺少【${step.criteria}】相关表述`,
        });
      }
    }

    const safeTotal = Math.min(totalScore, input.maxScore);
    const normalizedStudentAnswer = normalizeEvidenceText(input.studentAnswer);
    const evidenceCoverage = rubricSteps.length === 0
      ? 0
      : stepEvaluations.filter((step) =>
          step.is_hit &&
          normalizeEvidenceText(step.evidence).length > 0 &&
          normalizedStudentAnswer.includes(normalizeEvidenceText(step.evidence))
        ).length / rubricSteps.length;
    const schemaComplete = stepEvaluations.length === rubricSteps.length &&
      stepEvaluations.every((step) =>
        Number.isFinite(step.score) &&
        step.score >= 0 &&
        step.score <= step.max_score &&
        (!step.is_hit || normalizeEvidenceText(step.evidence).length > 0)
      );
    // Confidence is evidence-driven rather than a fixed optimistic constant.
    const confidence = Math.max(0, Math.min(1,
      0.45 * evidenceCoverage +
      0.35 * (schemaComplete ? 1 : 0) +
      0.20 * (normalizedStudentAnswer.length > 0 ? 1 : 0)
    ));
    const reviewRequired = !schemaComplete || confidence < 0.75;

    return {
      totalAwardedScore: safeTotal,
      maxScore: input.maxScore,
      confidence,
      reviewRequired,
      stepEvaluations,
      overallSummary:
        safeTotal === input.maxScore
          ? "作答要点完整，表述严谨规范，采分点全部命中。"
          : `得分 ${safeTotal}/${input.maxScore} 分。部分采分点存在缺漏，请参考失分原因针对性订正。`,
      modelUsed: this.modelName,
      latencyMs,
    };
  }
}

/** Extract a conventional A/B/C/D selection from the agent's answer evidence. */
function normalizeEvidenceText(value: string): string {
  return (value || "").replace(/[\\s\\p{P}]/gu, "").toLowerCase();
}

function normalizeObjectiveAnswer(value: string): string {
  const text = (value || "").trim().toUpperCase();
  const explicit = [...text.matchAll(/[（(\[]\s*([A-D])\s*[）)\]]/g)].at(-1)?.[1];
  if (explicit) return explicit;
  const answerLabel = text.match(/(?:答案|选择|选)\s*[:：]?\s*([A-D])\b/);
  if (answerLabel) return answerLabel[1];
  return /^[A-D]$/.test(text) ? text : text;
}
