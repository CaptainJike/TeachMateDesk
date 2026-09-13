import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "../core/types.js";

export const RubricStepSchema = Type.Object({
  step_no: Type.Integer({ description: "步骤序号，从 1 开始" }),
  score: Type.Number({ description: "该采分步骤分值" }),
  criteria: Type.String({ description: "核心采分评定标准与要点描述" }),
  keywords: Type.Array(Type.String(), { description: "核心采分关键词或关键句式列表" }),
});

export const GenerateRubricStepsSchema = Type.Object({
  question_title: Type.String({ description: "题目或小问标题" }),
  max_score: Type.Number({ description: "题目总满分" }),
  standard_answer: Type.Optional(Type.String({ description: "题目标准参考答案 (如填空题默写原句、简答题标答、作文立意示范)" })),
  analysis: Type.Optional(Type.String({ description: "考点解析与解题思路说明" })),
  steps: Type.Array(RubricStepSchema, { description: "拆解出的分步采分细则列表" }),
});

export type GenerateRubricStepsArgs = Static<typeof GenerateRubricStepsSchema>;

export const createGenerateRubricStepsTool = (): AgentTool<typeof GenerateRubricStepsSchema> => ({
  name: "generate_rubric_steps",
  description: "根据教师参考答案与题干，将答案解析拆解为带权重、要点、关键词的分步采分细则 (Rubric Steps)",
  parameters: GenerateRubricStepsSchema,
  execute: async (args: GenerateRubricStepsArgs) => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "SUCCESS",
            steps_count: args.steps.length,
            total_rubric_score: args.steps.reduce((acc, s) => acc + s.score, 0),
            steps: args.steps,
          }),
        },
      ],
      details: {
        steps: args.steps,
      },
    };
  },
});
