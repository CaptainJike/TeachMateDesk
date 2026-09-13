import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "../core/types.js";

export const DiagnoseErrorSchema = Type.Object({
  question_num: Type.Integer({ description: "题目序号" }),
  error_type: Type.String({
    description: "错因分类: KNOWLEDGE_GAP (知识盲区) / LOGIC_STEP_MISSING (逻辑跳步) / CALC_ERROR (计算失误) / EXPRESSION_BIAS (表达偏差)",
  }),
  gap_analysis: Type.String({ description: "学生作答中的具体缺陷剖析" }),
  heuristic_hint: Type.String({ description: "启发式引导提示，避免直接给答案" }),
  recommended_knowledge: Type.Array(Type.String(), { description: "推荐复习的知识点/教材单元标签" }),
});

export type DiagnoseErrorArgs = Static<typeof DiagnoseErrorSchema>;

export const createDiagnoseErrorTool = (): AgentTool<typeof DiagnoseErrorSchema> => ({
  name: "diagnose_error",
  description: "根据学生批改失分情况，对错因进行四分类归因并输出启发式辅导建议",
  parameters: DiagnoseErrorSchema,
  execute: async (args: DiagnoseErrorArgs) => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "SUCCESS",
            error_type: args.error_type,
            hint: args.heuristic_hint,
            tags: args.recommended_knowledge,
          }),
        },
      ],
      details: {
        error_type: args.error_type,
        gap_analysis: args.gap_analysis,
        heuristic_hint: args.heuristic_hint,
        recommended_knowledge: args.recommended_knowledge,
      },
    };
  },
});
