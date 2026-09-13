import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "../core/types.js";
import { FileBasedRetriever } from "../retriever/file-based-retriever.js";

export const QueryTextbookKnowledgeSchema = Type.Object({
  subject: Type.String({ description: "学科标识，如 chinese", default: "chinese" }),
  grade: Type.String({ description: "学段年级，如 grade8", default: "grade8" }),
  volume: Type.String({ description: "教材册次，如 volume_1 或 volume_2", default: "volume_1" }),
  query: Type.String({ description: "需检索的课文题目、作者背景、古诗文释义、名句或修辞手法关键词" }),
  top_k: Type.Optional(Type.Integer({ description: "检索返回的相关课文段落数量，默认 2", default: 2 })),
});

export type QueryTextbookKnowledgeArgs = Static<typeof QueryTextbookKnowledgeSchema>;

export const createQueryTextbookKnowledgeTool = (
  retriever: FileBasedRetriever
): AgentTool<typeof QueryTextbookKnowledgeSchema> => ({
  name: "query_textbook_knowledge",
  description: "基于本地结构化教材库检索课文原文、古诗文注解、作者背景及知识点，作为主观题评分与采分点生成的权威依据",
  parameters: QueryTextbookKnowledgeSchema,
  execute: async (args: QueryTextbookKnowledgeArgs) => {
    const matches = await retriever.retrieve(args);
    if (matches.length === 0) {
      return {
        content: [{ type: "text", text: `[教材知识库检索 (${args.query})]: 未检索到完全匹配的课文知识。` }],
        details: { matches: [] },
      };
    }

    const formatted = matches
      .map((m, idx) => `### 【参考依据 ${idx + 1}】《${m.title}》（${m.author} | ${m.unit}）\n${m.content}`)
      .join("\n\n---\n\n");

    return {
      content: [{ type: "text", text: `[教材知识库检索命中 (${matches.length} 篇)]:\n\n${formatted}` }],
      details: { matches },
    };
  },
});
