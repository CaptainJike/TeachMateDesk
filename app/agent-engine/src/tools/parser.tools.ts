import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "../core/types.js";

export const QuestionEntitySchema = Type.Object({
  num: Type.Integer({ description: "大题题号 (1, 2, 3...)" }),
  sub_num: Type.Optional(Type.String({ description: "小问序号 (如 1.1, 2.1)" })),
  type: Type.String({ description: "题型: single_choice, multi_choice, judge, fill_blank, subjective_short, essay" }),
  stem: Type.String({ description: "题目题干 Markdown 文本" }),
  options: Type.Optional(Type.Array(Type.String(), { description: "选项列表" })),
  score: Type.Number({ description: "题目分值" }),
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
            total_score: args.questions.reduce((acc, q) => acc + q.score, 0),
          }),
        },
      ],
      details: {
        questions: args.questions,
      },
    };
  },
});
