import type { ModelTier } from "../providers/model-registry.js";

export type SchoolStage = "PRIMARY" | "MIDDLE" | "HIGH";

export interface QuestionRouteMetadata {
  subject: "chinese" | "math" | "physics" | "chemistry" | "english";
  school_stage: SchoolStage;
  grade?: string;
  textbook_version?: string;
  semester?: string;
  domain:
    | "reading_comprehension"
    | "ancient_poetry"
    | "classical_chinese"
    | "language_application"
    | "essay_writing"
    | "math_algebra"
    | "math_geometry"
    | "physics_mechanics";
  question_type: "single_choice" | "multi_choice" | "judge" | "fill_blank" | "subjective_short" | "essay" | "proof";
  difficulty: "easy" | "medium" | "hard";
  model_tier: ModelTier;
  target_agent: "ChineseExpertAgent" | "MathExpertAgent" | "PhysicsExpertAgent" | "EnglishExpertAgent";
}

export interface RouteInput {
  stem: string;
  type?: string;
  score?: number;
  subject?: "chinese" | "math" | "physics" | "chemistry" | "english";
  school_stage?: SchoolStage;
  grade?: string;
  textbook_version?: string;
  semester?: string;
}

export class RouterAgent {
  public route(input: RouteInput): QuestionRouteMetadata {
    const subject = input.subject || "chinese";
    const stage = input.school_stage || "MIDDLE";
    const stem = input.stem || "";
    const type = (input.type || "").toLowerCase();

    // 1. Determine question type
    let qType: QuestionRouteMetadata["question_type"] = "subjective_short";
    if (type.includes("choice") || type.includes("single") || stem.includes("( )") || stem.includes("（ ）")) {
      qType = "single_choice";
    } else if (type.includes("multi")) {
      qType = "multi_choice";
    } else if (type.includes("judge") || stem.includes("判断")) {
      qType = "judge";
    } else if (type.includes("blank") || type.includes("fill") || stem.includes("默写") || stem.includes("填空")) {
      qType = "fill_blank";
    } else if (type.includes("essay") || stem.includes("作文") || (input.score && input.score >= 30)) {
      qType = "essay";
    }

    // 2. Determine domain
    let domain: QuestionRouteMetadata["domain"] = "language_application";
    if (stem.includes("阅读") || stem.includes("简析") || stem.includes("划线句") || stem.includes("概括")) {
      domain = "reading_comprehension";
    } else if (stem.includes("古诗") || stem.includes("默写") || stem.includes("杜牧") || stem.includes("苏轼") || stem.includes("李白")) {
      domain = "ancient_poetry";
    } else if (stem.includes("文言") || stem.includes("断句") || stem.includes("翻译") || stem.includes("通假")) {
      domain = "classical_chinese";
    } else if (qType === "essay") {
      domain = "essay_writing";
    }

    // 3. Determine Model Tier
    let modelTier: ModelTier = "TIER_2_STANDARD";
    if (qType === "single_choice" || qType === "multi_choice" || qType === "judge") {
      modelTier = "TIER_1_FAST";
    } else if (qType === "essay" || domain === "reading_comprehension" || domain === "classical_chinese") {
      modelTier = "TIER_3_DEEP";
    }

    // 4. Determine Difficulty
    let difficulty: "easy" | "medium" | "hard" = "medium";
    if (modelTier === "TIER_1_FAST") difficulty = "easy";
    if (modelTier === "TIER_3_DEEP" && (input.score || 0) >= 6) difficulty = "hard";

    return {
      subject,
      school_stage: stage,
      grade: input.grade || "初二",
      textbook_version: input.textbook_version || "统编版",
      semester: input.semester || "八年级上册",
      domain,
      question_type: qType,
      difficulty,
      model_tier: modelTier,
      target_agent: "ChineseExpertAgent",
    };
  }
}
