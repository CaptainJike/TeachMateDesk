import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "../core/types.js";

// 1. Verify Step Score Schema
export const VerifyStepScoreSchema = Type.Object({
  step_no: Type.Integer({ description: "采分步骤序号，从 1 开始" }),
  max_step_score: Type.Number({ description: "该步骤预设的最大满分" }),
  awarded_score: Type.Number({ description: "学生在该步骤实际获得的得分" }),
  is_hit: Type.Boolean({ description: "学生作答是否命中该步骤的核心采分要点" }),
  evidence_quote: Type.String({ description: "从学生作答中提取的具体文本证据或原文引用" }),
  deduction_reason: Type.Optional(Type.String({ description: "失分原因详述（未得满分时必填）" })),
});

export type VerifyStepScoreArgs = Static<typeof VerifyStepScoreSchema>;

export const createVerifyStepScoreTool = (): AgentTool<typeof VerifyStepScoreSchema> => ({
  name: "verify_step_score",
  description: "用于在主观题批改过程中，对特定采分步骤（Rubric Step）进行核验与打分记录",
  parameters: VerifyStepScoreSchema,
  execute: async (args: VerifyStepScoreArgs) => {
    const safeScore = Math.max(0, Math.min(args.awarded_score, args.max_step_score));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "SUCCESS",
            step_no: args.step_no,
            awarded_score: safeScore,
            max_score: args.max_step_score,
            is_hit: args.is_hit,
            evidence: args.evidence_quote,
            deduction_reason: args.deduction_reason || "无失分",
          }),
        },
      ],
      details: {
        step_no: args.step_no,
        score: safeScore,
        max_score: args.max_step_score,
        is_hit: args.is_hit,
        evidence: args.evidence_quote,
        reason: args.deduction_reason || "无失分",
      },
    };
  },
});

// 2. Compare Objective Tool
export const CompareObjectiveSchema = Type.Object({
  question_num: Type.Integer({ description: "题目大题序号" }),
  sub_num: Type.Optional(Type.String({ description: "小问序号" })),
  question_type: Type.String({ description: "题型: single_choice, multi_choice, judge" }),
  standard_answer: Type.String({ description: "标准正确答案选项，如 A 或 ABCD" }),
  student_answer: Type.String({ description: "学生实际作答选项" }),
  score_value: Type.Number({ description: "该题满分" }),
});

export type CompareObjectiveArgs = Static<typeof CompareObjectiveSchema>;

export const createCompareObjectiveTool = (): AgentTool<typeof CompareObjectiveSchema> => ({
  name: "compare_objective",
  description: "用于单选、多选、判断等客观题的快速标准答案比对判分",
  parameters: CompareObjectiveSchema,
  execute: async (args: CompareObjectiveArgs) => {
    const std = (args.standard_answer || "").trim().toUpperCase();
    const stu = (args.student_answer || "").trim().toUpperCase();

    let isCorrect = false;
    let awarded = 0;

    if (args.question_type === "multi_choice") {
      if (std === stu) {
        isCorrect = true;
        awarded = args.score_value;
      } else {
        const stdSet = new Set(std.split(""));
        const stuSet = new Set(stu.split(""));
        const isSubset = Array.from(stuSet).every((c) => stdSet.has(c));
        if (isSubset && stu.length > 0) {
          awarded = Math.floor(args.score_value / 2);
          isCorrect = false;
        } else {
          awarded = 0;
          isCorrect = false;
        }
      }
    } else {
      isCorrect = std === stu;
      awarded = isCorrect ? args.score_value : 0;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "SUCCESS",
            is_correct: isCorrect,
            awarded_score: awarded,
            standard: std,
            student: stu,
          }),
        },
      ],
      details: {
        is_correct: isCorrect,
        awarded_score: awarded,
        standard: std,
        student: stu,
      },
    };
  },
});
