import { Agent } from "../core/agent.js";
import { getTierModel } from "../providers/model-registry.js";
import { createGenerateRubricStepsTool, type GenerateRubricStepsArgs } from "../tools/rubric.tools.js";
import { createQueryTextbookKnowledgeTool } from "../tools/knowledge-rag.tools.js";
import { FileBasedRetriever } from "../retriever/file-based-retriever.js";
import type { SchoolStage } from "./router.agent.js";

export interface RubricStep {
  step_no: number;
  score: number;
  criteria: string;
  keywords: string[];
}

export interface RubricGenerationInput {
  questionTitle: string;
  stem: string;
  maxScore: number;
  referenceAnswer: string;
  analysis?: string;
  school_stage?: SchoolStage;
  grade?: string;
}

export interface RubricGenerationOutput {
  rubricSteps: RubricStep[];
  standardAnswer?: string;
  analysis?: string;
  totalScore: number;
  latencyMs: number;
}

export class RubricAgent {
  private agent: Agent;
  private generatedSteps: RubricStep[] = [];
  private generatedStandardAnswer?: string;
  private generatedAnalysis?: string;
  private retriever: FileBasedRetriever;

  constructor(retriever?: FileBasedRetriever, stage: SchoolStage = "MIDDLE") {
    this.retriever = retriever || new FileBasedRetriever();
    const model = getTierModel("TIER_3_DEEP");
    const rubricTool = createGenerateRubricStepsTool();
    const ragTool = createQueryTextbookKnowledgeTool(this.retriever);

    const stageGuidance = {
      PRIMARY: "【小学段】：采分点需明确字词拼写、标点符号及语句通顺的分值权重；",
      MIDDLE: "【初中段】：采分点需紧扣课本知识点、修辞手法、文言实虚词及结构概括要点；",
      HIGH: "【高中段】：采分点需突出立意主旨、论述思辨深度、批判性分析与严密逻辑。",
    }[stage];

    this.agent = new Agent({
      initialState: {
        model,
        tools: [rubricTool, ragTool],
        systemPrompt: `你是一名资深教研员与中考/高考阅卷组长。
当前学段：${stage}。
${stageGuidance}

你的职责是根据题目题干与参考要点，生成准确的标准参考答案 (standard_answer)、考点解析 (analysis) 以及细粒度分步采分细则 (Rubric Steps)。
规则：
1. 填空题/默写题：必须在 \`standard_answer\` 中完整输出各空准确诗句/字词；
2. 主观题/探究题：在 \`standard_answer\` 中输出规范的标准表述与采分要点；
3. 分步采分总和必须严格等于题目满分；
4. 每个步骤必须提供明确的 \`criteria\`（采分标准）和 \`keywords\`（核心关键词/短语）；
5. 必须调用 \`generate_rubric_steps\` 工具返回结构化采分细则。`,
      },
      afterToolCall: async (ctx) => {
        if (ctx.toolCall.name === "generate_rubric_steps") {
          const args = ctx.toolCall.arguments as GenerateRubricStepsArgs;
          this.generatedSteps = args.steps;
          this.generatedStandardAnswer = args.standard_answer;
          this.generatedAnalysis = args.analysis;
        }
        return {};
      },
    });
  }

  public async generateRubric(input: RubricGenerationInput): Promise<RubricGenerationOutput> {
    const start = Date.now();
    this.generatedSteps = [];
    this.generatedStandardAnswer = undefined;
    this.generatedAnalysis = undefined;

    const promptText = `
请为以下题目生成标准答案与分步采分细则 (Rubric)：
【题目】：${input.questionTitle}
【题干】：${input.stem}
【满分】：${input.maxScore} 分
【参考提示】：${input.referenceAnswer || "请结合语文学科规范与课本知识作答"}
【现有解析】：${input.analysis || "无"}
`;

    await this.agent.prompt(promptText);

    if (this.generatedSteps.length === 0) {
      this.generatedSteps = this.createFallbackSteps(input);
    }

    // 若大模型未单独提供 standardAnswer，则从分步采分点中智能聚合
    let finalStandardAnswer: string = this.generatedStandardAnswer || "";
    if (!finalStandardAnswer || finalStandardAnswer.trim().length === 0) {
      if (this.generatedSteps.some((s) => s.keywords && s.keywords.length > 0)) {
        finalStandardAnswer = this.generatedSteps
          .map((s) => s.keywords.join(" / "))
          .filter(Boolean)
          .join("；");
      } else {
        finalStandardAnswer = input.referenceAnswer || "参考答案已由 AI 综合生成，请教师审核确认。";
      }
    }

    const totalScore = this.generatedSteps.reduce((acc, s) => acc + s.score, 0);
    const latencyMs = Date.now() - start;

    return {
      rubricSteps: this.generatedSteps,
      standardAnswer: finalStandardAnswer,
      analysis: this.generatedAnalysis || "分步采分细则已由 Rubric Agent 自动生成，待教师审核。",
      totalScore,
      latencyMs,
    };
  }

  private createFallbackSteps(input: RubricGenerationInput): RubricStep[] {
    const score = input.maxScore || 4;
    const ref = input.referenceAnswer || "";

    if (score <= 2) {
      return [
        {
          step_no: 1,
          score,
          criteria: `准确回答出核心要点：${ref.slice(0, 30)}`,
          keywords: ref.split(/[，,。、\s]/).filter((w) => w.length >= 2).slice(0, 3),
        },
      ];
    }

    const half = Math.floor(score / 2);
    const remainder = score - half;

    return [
      {
        step_no: 1,
        score: half,
        criteria: "准确回答文章主旨、观点或基础要点",
        keywords: ["主旨", "情感", "要点"],
      },
      {
        step_no: 2,
        score: remainder,
        criteria: "结合原文语句进行深入分析或修辞阐释，表达规范通顺",
        keywords: ["分析", "表现手法", "修辞", "生动"],
      },
    ];
  }
}
