import { Agent } from "../core/agent.js";
import { getTierModel } from "../providers/model-registry.js";
import { PiGradingRuntime } from "../runtime/pi-runtime.js";
import type { RuntimeImage } from "../runtime/grading-runtime.js";
interface ExamQuestionRef {
  id: string;
  question_num: number;
  sub_num?: string;
  q_type: string;
  stem_text: string;
}

export interface IdentityEvidence {
  studentName: string;
  className: string;
  studentNumber: string;
  confidence: number;
  evidence: string;
}

export interface VisionPageEvidence {
  page: number;
  rotation: 0 | 90 | 180 | 270;
  layout: "single_column" | "multi_column" | "mixed" | "unknown";
  confidence: number;
}

export interface VisionAnswer {
  questionId: string;
  questionNumber: string;
  studentAnswer: string;
  answerEvidence: string;
  answerRegion: { page: number; description: string; x?: number; y?: number; width?: number; height?: number };
  confidence: number;
  isCrossQuestionRisk: boolean;
  reviewRequired: boolean;
  reviewReason: string;
}

export interface VisionAnswerAnalysis {
  identity: IdentityEvidence;
  pages: VisionPageEvidence[];
  answers: VisionAnswer[];
  reviewRequired: boolean;
  reviewReason: string;
}

export interface ExamQuestionObservation {
  questionNumber: number;
  subNumber?: string;
  /** 所属大题标题，例如“四、计算题”，供题型权重归一化使用。 */
  sectionTitle?: string;
  type: string;
  /** AI 识别的细分题型，例如 oral_calculation / vertical_calculation。 */
  subType?: string;
  difficulty?: "easy" | "medium" | "hard";
  stem: string;
  options?: string[];
  /** 原卷明确标注的分值；未标注时必须是 null，禁止臆测。 */
  score: number | null;
  /** 分值来源：original=原卷明确写出；ai=从上下文推测；auto=程序自动；manual=教师手工。 */
  scoreSource?: "original" | "ai" | "auto" | "manual" | null;
  correctAnswer: string;
  analysis: string;
  rubricSteps: Array<{ step_no: number; score: number; criteria: string; keywords: string[] }>;
}

export interface ExamVisionAnalysis {
  title: string;
  questions: ExamQuestionObservation[];
  pages: VisionPageEvidence[];
  reviewRequired: boolean;
  reviewReason: string;
}

export class VisionAnswerAgent {
  private readonly model = getTierModel("TIER_1_FAST");
  private readonly runtime = new PiGradingRuntime();

  private createAgent(systemPrompt: string): Agent {
    return new Agent({
      initialState: { model: this.model, systemPrompt },
      responseFormat: { type: "json_object" },
    });
  }

  public async analyzeStudentAnswers(params: {
    images: RuntimeImage[];
    questions: ExamQuestionRef[];
  }): Promise<VisionAnswerAnalysis> {
    if (!params.images.length) throw new Error("未提供学生答卷原图");
    const agent = this.createAgent(`你是 VisionAnswerAgent。你只能根据原始试卷图片判断事实，不能根据标准答案猜测学生答案。
输出严格 JSON，不要 Markdown。识别不确定时必须 reviewRequired=true。
答案必须绑定到题目区域，记录图片中的证据原文和页码；划掉的答案不要作为最终答案，存在跨题风险也必须复核。请为每道题返回 answerRegion 精确区域，x/y 是左上角坐标，width/height 是区域尺寸，全部使用 0 到 1 的相对比例（相对于整页图片）；宁可扩大区域覆盖完整答案，不要裁掉“答：”或最终结论。`);
    const prompt = `请查看所有图片，提取学生身份和每道题的最终作答。
题目清单：${JSON.stringify(params.questions)}
JSON 格式：${JSON.stringify({
      identity: { studentName: "", className: "", studentNumber: "", confidence: 0, evidence: "" },
      pages: [{ page: 1, rotation: 0, layout: "single_column", confidence: 0 }],
      answers: [{ questionId: "", questionNumber: "", studentAnswer: "", answerEvidence: "", answerRegion: { page: 1, description: "答题区域", x: 0, y: 0, width: 1, height: 1 }, confidence: 0, isCrossQuestionRisk: false, reviewRequired: false, reviewReason: "" }],
      reviewRequired: false,
      reviewReason: "",
    })}`;
    const raw = await this.runModel(agent, systemPromptForStudent(), prompt, params.images);
    return normalizeStudentAnalysis(parseJson(raw), params.questions);
  }

  public async analyzeExam(params: { images: RuntimeImage[]; title?: string }): Promise<ExamVisionAnalysis> {
    if (!params.images.length) throw new Error("未提供试卷原图");
    const agent = this.createAgent(systemPromptForExam());
    const prompt = `请分析这些试卷图片，按题号和小问建立可供教师复核的结构化试卷。每一个具有独立作答内容和独立分值的题目/小题必须输出一条 questions 记录，不能把同一大题下的（1）（2）合并；questionNumber 填所属大题号，subNumber 填完整层级编号（例如大题 5 下的第 1 大小题的两个问分别填 5.1.1、5.1.2）。如果只有一层小题，可填 1.1、1.2。不要把大题号重复拼接到已经完整的 subNumber 上。
请尽可能识别试卷中原本存在的分数信息，包括：每道大题总分（如“每题2分，共20分”）、每道小题分值、“共X分”、括号中的分值（如“（5分）”）、题目末尾出现的分数。
如果试卷中没有明确标注分数，不要自行猜测 score，score 返回 null 且 scoreSource 返回 null；只有原卷明确写出分值时 scoreSource 才填 "original"。
${params.title ? `教师提供的试卷名称：${params.title}\n` : ""}
JSON 格式：${JSON.stringify({
      title: params.title || "",
      pages: [{ page: 1, rotation: 0, layout: "single_column", confidence: 0 }],
      questions: [{ questionNumber: 1, subNumber: "", sectionTitle: "一、填空题", type: "fill_blank", subType: "", difficulty: "medium", stem: "", options: [], score: null, scoreSource: null, correctAnswer: "", analysis: "", rubricSteps: [{ step_no: 1, score: 0, criteria: "", keywords: [] }] }],
      reviewRequired: false,
      reviewReason: "",
    })}`;
    const raw = await this.runModel(agent, systemPromptForExam(), prompt, params.images);
    return normalizeExamAnalysis(parseJson(raw), params.title);
  }

  private async runModel(agent: Agent, systemPrompt: string, prompt: string, images: RuntimeImage[]): Promise<string> {
    if ((process.env.PI_RUNTIME || "pi") === "pi") {
      return this.runtime.run({ runId: `vision_${Date.now()}`, model: this.model, systemPrompt, images }, prompt, images);
    }
    return agent.prompt(prompt, images);
  }
}

function systemPromptForStudent(): string {
  return `你是 VisionAnswerAgent。你只能根据原始试卷图片判断事实，不能根据标准答案猜测学生答案。输出严格 JSON，不要 Markdown。识别不确定时必须 reviewRequired=true。`;
}

function systemPromptForExam(): string {
  return `你是 TeachMate 试卷管理 Agent。直接阅读试卷和参考答案图片，提取题目、题型、原卷已有分值、标准答案和每题评分标准。
输出严格 JSON，不要 Markdown。无法确认的题目或答案必须标记 reviewRequired=true，绝不能臆测。
关于分值：请优先识别试卷中真实出现的分数（大题信息行如“每题2分，共20分”、小题括号分值如“（5分）”、题目末尾分值、“共X分”）。
如果原卷没有明确标注某题分值，score 必须返回 null、scoreSource 返回 null，不要凭经验猜测具体分数；分值由系统统一自动配分。
如果原卷明确写出了分值，score 返回该分值且 scoreSource 返回 "original"；如果是你自己根据题型推断出来的分值，scoreSource 返回 "ai"。`;
}

function parseJson(raw: string): any {
  const source = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("多模态 Agent 未返回有效 JSON，已进入复核");
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch {
    throw new Error("多模态 Agent JSON 解析失败，已进入复核");
  }
}

function normalizeStudentAnalysis(value: any, questions: ExamQuestionRef[]): VisionAnswerAnalysis {
  const answers = Array.isArray(value.answers) ? value.answers : [];
  const normalizedAnswers: VisionAnswer[] = questions.map((question) => {
    const expectedNumber = formatQuestionNumber(question.question_num, question.sub_num);
    const found = answers.find((item: any) => item.questionId === question.id)
      || answers.find((item: any) => String(item.questionNumber).trim() === expectedNumber && Boolean(question.sub_num))
      || (!question.sub_num ? answers.find((item: any) => String(item.questionNumber).trim() === expectedNumber) : undefined);
    const answer: VisionAnswer = {
      questionId: question.id,
      questionNumber: expectedNumber,
      studentAnswer: String(found?.studentAnswer || "").trim(),
      answerEvidence: String(found?.answerEvidence || "").trim(),
      answerRegion: {
        page: Number(found?.answerRegion?.page) || 1,
        description: String(found?.answerRegion?.description || "").trim(),
        x: normalizedCoordinate(found?.answerRegion?.x),
        y: normalizedCoordinate(found?.answerRegion?.y),
        width: normalizedCoordinate(found?.answerRegion?.width),
        height: normalizedCoordinate(found?.answerRegion?.height),
      },
      confidence: clamp(found?.confidence),
      isCrossQuestionRisk: Boolean(found?.isCrossQuestionRisk),
      reviewRequired: Boolean(found?.reviewRequired),
      reviewReason: String(found?.reviewReason || "").trim(),
    };
    if (!answer.answerEvidence || answer.confidence < 0.75 || answer.isCrossQuestionRisk) {
      answer.reviewRequired = true;
      answer.reviewReason ||= "图片证据不足或题目绑定存在风险";
    }
    return answer;
  });
  const reviewRequired = Boolean(value.reviewRequired) || normalizedAnswers.some((answer) => answer.reviewRequired);
  return {
    identity: {
      studentName: String(value.identity?.studentName || "").trim(),
      className: String(value.identity?.className || "").trim(),
      studentNumber: String(value.identity?.studentNumber || "").trim(),
      confidence: clamp(value.identity?.confidence),
      evidence: String(value.identity?.evidence || "").trim(),
    },
    pages: normalizePages(value.pages),
    answers: normalizedAnswers,
    reviewRequired,
    reviewReason: String(value.reviewReason || (reviewRequired ? "部分视觉证据需要教师核验" : "")).trim(),
  };
}

function normalizedCoordinate(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : undefined;
}

function normalizeExamAnalysis(value: any, title?: string): ExamVisionAnalysis {
  const questions = Array.isArray(value.questions) ? value.questions : [];
  return {
    title: String(value.title || title || "导入试卷").trim(),
    pages: normalizePages(value.pages),
    questions: questions.map((question: any) => ({
      questionNumber: Number(question.questionNumber) || 0,
      subNumber: question.subNumber ? String(question.subNumber) : undefined,
      sectionTitle: question.sectionTitle ? String(question.sectionTitle).trim() : undefined,
      type: String(question.type || "subjective_short"),
      subType: question.subType ? String(question.subType).trim() : undefined,
      difficulty: ["easy", "medium", "hard"].includes(String(question.difficulty))
        ? (String(question.difficulty) as "easy" | "medium" | "hard")
        : undefined,
      stem: String(question.stem || "").trim(),
      options: Array.isArray(question.options) ? question.options.map(String) : undefined,
      score: normalizeOptionalScore(question.score),
      scoreSource: normalizeScoreSource(question.scoreSource, question.score),
      correctAnswer: String(question.correctAnswer || "").trim(),
      analysis: String(question.analysis || "").trim(),
      rubricSteps: Array.isArray(question.rubricSteps) ? question.rubricSteps.map((step: any, index: number) => ({
        step_no: Number(step.step_no) || index + 1,
        score: Number(step.score) || 0,
        criteria: String(step.criteria || "").trim(),
        keywords: Array.isArray(step.keywords) ? step.keywords.map(String) : [],
      })) : [],
    })).filter((question: ExamQuestionObservation) => question.questionNumber > 0 && question.stem),
    reviewRequired: Boolean(value.reviewRequired) || questions.length === 0,
    reviewReason: String(value.reviewReason || (questions.length === 0 ? "未识别到题目" : "")).trim(),
  };
}

/** 未标注分值的题目必须保持 null，避免 AI 臆测分值被当作原卷分值保护起来。 */
function normalizeOptionalScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeScoreSource(
  value: unknown,
  rawScore: unknown,
): "original" | "ai" | "auto" | "manual" | null {
  const score = normalizeOptionalScore(rawScore);
  if (score === null) return null;
  const source = String(value ?? "").trim().toLowerCase();
  if (source === "original") return "original";
  if (source === "ai") return "ai";
  // 未声明来源但有具体分值：按 AI 推测处理，交由程序配分引擎重新校验
  return "ai";
}

function normalizePages(value: any): VisionPageEvidence[] {
  return (Array.isArray(value) ? value : []).map((page: any, index: number) => ({
    page: Number(page.page) || index + 1,
    rotation: [0, 90, 180, 270].includes(Number(page.rotation)) ? Number(page.rotation) as 0 | 90 | 180 | 270 : 0,
    layout: ["single_column", "multi_column", "mixed", "unknown"].includes(page.layout) ? page.layout : "unknown",
    confidence: clamp(page.confidence),
  }));
}

function formatQuestionNumber(questionNum: number, subNum?: string): string {
  const main = String(questionNum);
  const cleanSub = String(subNum || "").trim().replace(/^第\s*/, "").replace(/题$/, "").replace(/[．、-]/g, ".");
  if (!cleanSub) return main;
  if (cleanSub === main) return `${main}.1`;
  return cleanSub.startsWith(`${main}.`) ? cleanSub : `${main}.${cleanSub}`;
}

function clamp(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}
