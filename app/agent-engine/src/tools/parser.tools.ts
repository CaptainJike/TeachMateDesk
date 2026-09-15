import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "../core/types.js";

export const QuestionEntitySchema = Type.Object({
  num: Type.Integer({ description: "大题题号 (1, 2, 3...)" }),
  sub_num: Type.Optional(Type.String({ description: "小问序号 (如 1.1, 2.1)" })),
  type: Type.String({ description: "题型: single_choice, multi_choice, judge, fill_blank, subjective_short, essay" }),
  sub_type: Type.Optional(Type.String({ description: "细分题型 (如 oral_calculation, vertical_calculation, equation)" })),
  difficulty: Type.Optional(Type.String({ description: "难度: easy, medium, hard" })),
  section_title: Type.Optional(Type.String({ description: "所属大题标题 (如 四、计算题)" })),
  stem: Type.String({ description: "题目题干 Markdown 文本" }),
  options: Type.Optional(Type.Array(Type.String(), { description: "选项列表" })),
  score: Type.Optional(
    Type.Union([Type.Number(), Type.Null()], {
      description: "原卷明确标注的分值；未标注时必须返回 null，禁止猜测",
    }),
  ),
  score_source: Type.Optional(
    Type.Union([Type.Literal("original"), Type.Literal("ai"), Type.Null()], {
      description: "分值来源：original=原卷明确写出，ai=AI 推测，null=未识别到分值",
    }),
  ),
});

export const ExtractQuestionsSchema = Type.Object({
  exam_title: Type.String({ description: "试卷解析标题" }),
  questions: Type.Array(QuestionEntitySchema, { description: "结构化题目列表" }),
});

export type ExtractQuestionsArgs = Static<typeof ExtractQuestionsSchema>;

export const createExtractQuestionsTool = (): AgentTool<typeof ExtractQuestionsSchema> => ({
  name: "extract_questions",
  description: "根据 Agent 提供的试卷内容，智能识别切割各大题与小问实体",
  parameters: ExtractQuestionsSchema,
  execute: async (args: ExtractQuestionsArgs) => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "SUCCESS",
            exam_title: args.exam_title,
            questions_count: args.questions.length,
            total_score: args.questions.reduce((acc, q) => acc + (Number(q.score) || 0), 0),
          }),
        },
      ],
      details: {
        questions: args.questions,
      },
    };
  },
});
