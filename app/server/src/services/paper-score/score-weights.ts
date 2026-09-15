/**
 * 试卷自动配分 —— 题型权重与题型归一化。
 *
 * AI 只负责识别题型、题目结构与原卷已有分值；分值计算全部由程序完成。
 * 本模块提供各学科的题型基础权重与"原始题型文本 → 标准题型"的归一化规则。
 */

export type ScoreWeightTable = Record<string, number>;

/** 数学 / 理科通用权重（方案 7.1）。 */
export const MATH_WEIGHTS: ScoreWeightTable = {
  判断题: 1,
  选择题: 1.2,
  填空题: 1.3,
  口算题: 1,
  直接写得数: 1,
  单位换算: 1.3,
  竖式计算: 2,
  脱式计算: 2,
  解方程: 2,
  计算题: 2,
  操作题: 2,
  作图题: 2.5,
  看图题: 1.5,
  简答题: 2,
  应用题: 3,
  解决问题: 3,
  综合题: 3.5,
  探究题: 4,
  作文: 8,
};

/** 语文权重（方案 8）。 */
export const CHINESE_WEIGHTS: ScoreWeightTable = {
  看拼音写词语: 1,
  生字词: 1,
  词语搭配: 1,
  古诗填空: 1,
  选择题: 1,
  判断题: 1,
  填空题: 1,
  修改病句: 1.5,
  句子仿写: 1.5,
  阅读理解客观题: 1.5,
  阅读理解简答题: 2,
  综合阅读: 3,
  口语交际: 3,
  小练笔: 5,
  作文: 10,
};

/** 英语权重（方案 9）。 */
export const ENGLISH_WEIGHTS: ScoreWeightTable = {
  听力选择: 1,
  单词选择: 1,
  判断: 1,
  单词拼写: 1.2,
  词汇填空: 1.2,
  单项选择: 1,
  连词成句: 1.5,
  情景交际: 1.5,
  阅读选择: 1.5,
  阅读判断: 1.5,
  阅读简答: 2,
  写作: 4,
};

/** 无法判定学科时的兜底权重。 */
export const GENERIC_WEIGHTS: ScoreWeightTable = {
  ...MATH_WEIGHTS,
  ...CHINESE_WEIGHTS,
  简答题: 2,
  作文: 8,
};

/** AI 输出的 subType（方案 16）到标准题型的映射。 */
export const SUB_TYPE_TO_KEY: Record<string, string> = {
  oral_calculation: "口算题",
  mental_calculation: "口算题",
  vertical_calculation: "竖式计算",
  mixed_calculation: "脱式计算",
  simple_calculation: "脱式计算",
  equation: "解方程",
  word_problem: "解决问题",
  application: "应用题",
  geometry: "作图题",
  drawing: "作图题",
  operation: "操作题",
  reading: "阅读理解简答题",
  reading_comprehension: "阅读理解简答题",
  essay: "作文",
  writing: "写作",
  listening: "听力选择",
  spelling: "单词拼写",
  grammar: "单项选择",
  vocabulary: "词汇填空",
};

interface KeywordRule {
  pattern: RegExp;
  key: string;
}

/** 数学题型关键词（按特异性从高到低匹配，命中即返回）。 */
const MATH_RULES: KeywordRule[] = [
  { pattern: /探究/, key: "探究题" },
  { pattern: /综合/, key: "综合题" },
  { pattern: /解决问题|解决实际|实际应用/, key: "解决问题" },
  { pattern: /应用题|应用/, key: "应用题" },
  { pattern: /作图|画图|画一画|画出/, key: "作图题" },
  { pattern: /操作|动手做|动手操作/, key: "操作题" },
  { pattern: /解方程|求未知数|方程/, key: "解方程" },
  { pattern: /脱式|递等式|简便计算|简算/, key: "脱式计算" },
  { pattern: /竖式/, key: "竖式计算" },
  { pattern: /口算|心算/, key: "口算题" },
  { pattern: /直接写得数|直接写出得数/, key: "直接写得数" },
  { pattern: /单位换算|换算/, key: "单位换算" },
  { pattern: /看图/, key: "看图题" },
  { pattern: /计算/, key: "计算题" },
  { pattern: /判断/, key: "判断题" },
  { pattern: /选择/, key: "选择题" },
  { pattern: /填空/, key: "填空题" },
];

/** 语文题型关键词。 */
const CHINESE_RULES: KeywordRule[] = [
  { pattern: /作文|习作|写作/, key: "作文" },
  { pattern: /小练笔|练笔/, key: "小练笔" },
  { pattern: /口语交际|交际/, key: "口语交际" },
  { pattern: /看拼音写词语|看拼音/, key: "看拼音写词语" },
  { pattern: /词语搭配|搭配/, key: "词语搭配" },
  { pattern: /修改病句|病句/, key: "修改病句" },
  { pattern: /句子仿写|仿写|造句/, key: "句子仿写" },
  { pattern: /古诗|默写|诗句/, key: "古诗填空" },
  { pattern: /综合阅读/, key: "综合阅读" },
  { pattern: /阅读.*(选择|判断|客观)/, key: "阅读理解客观题" },
  { pattern: /(选择|判断).*阅读/, key: "阅读理解客观题" },
  { pattern: /阅读理解/, key: "阅读理解简答题" },
  { pattern: /阅读/, key: "阅读理解简答题" },
  { pattern: /生字|字词|拼音/, key: "生字词" },
  { pattern: /概括|分析|简答|问答|赏析/, key: "阅读理解简答题" },
  { pattern: /判断/, key: "判断题" },
  { pattern: /选择/, key: "选择题" },
  { pattern: /填空/, key: "填空题" },
];

/** 英语题型关键词。 */
const ENGLISH_RULES: KeywordRule[] = [
  { pattern: /写作|作文|writing/i, key: "写作" },
  { pattern: /情景交际|交际/, key: "情景交际" },
  { pattern: /连词成句/, key: "连词成句" },
  { pattern: /阅读.*(简答|问答)/, key: "阅读简答" },
  { pattern: /阅读.*判断/, key: "阅读判断" },
  { pattern: /阅读|reading/i, key: "阅读选择" },
  { pattern: /单词拼写|拼写|spelling/i, key: "单词拼写" },
  { pattern: /词汇填空|词汇/, key: "词汇填空" },
  { pattern: /听力/, key: "听力选择" },
  { pattern: /单项选择|single/i, key: "单项选择" },
  { pattern: /单词选择|选单词/, key: "单词选择" },
  { pattern: /判断/, key: "判断" },
  { pattern: /填空/, key: "词汇填空" },
  { pattern: /选择/, key: "单项选择" },
];

/** 归一化学科标识：支持中英文写法。 */
export function normalizeSubject(subject?: string): "math" | "chinese" | "english" | "generic" {
  const value = String(subject || "").trim().toLowerCase();
  if (!value) return "generic";
  if (["math", "maths", "mathematics", "数学", "science", "科学"].includes(value)) return "math";
  if (["chinese", "chinese_language", "语文"].includes(value)) return "chinese";
  if (["english", "英语"].includes(value)) return "english";
  return "generic";
}

export function getWeightTable(subject?: string): ScoreWeightTable {
  switch (normalizeSubject(subject)) {
    case "math":
      return MATH_WEIGHTS;
    case "chinese":
      return CHINESE_WEIGHTS;
    case "english":
      return ENGLISH_WEIGHTS;
    default:
      return GENERIC_WEIGHTS;
  }
}

function rulesForSubject(subject?: string): KeywordRule[] {
  switch (normalizeSubject(subject)) {
    case "chinese":
      return CHINESE_RULES;
    case "english":
      return ENGLISH_RULES;
    default:
      return MATH_RULES;
  }
}

function fallbackTypeForQType(qType: string, subject?: string): string {
  const type = String(qType || "").trim().toUpperCase();
  const normalized = normalizeSubject(subject);
  const isEnglish = normalized === "english";
  const isChinese = normalized === "chinese";
  switch (type) {
    case "SINGLE_CHOICE":
    case "MULTI_CHOICE":
      return isEnglish ? "单项选择" : "选择题";
    case "JUDGE":
      return isEnglish ? "判断" : "判断题";
    case "FILL_BLANK":
      return isEnglish ? "词汇填空" : "填空题";
    case "ESSAY":
      return isEnglish ? "写作" : isChinese ? "作文" : "综合题";
    case "SUBJECTIVE_SHORT":
    case "PROOF":
      return isEnglish ? "阅读简答" : isChinese ? "阅读理解简答题" : "解决问题";
    default:
      return isEnglish ? "单项选择" : isChinese ? "阅读理解简答题" : "简答题";
  }
}

/**
 * 题型归一化：把 AI 识别的原始题型文本压成权重表里的标准题型。
 * 匹配顺序：subType → 大题标题 → 题干片段 → q_type 兜底。
 */
export function normalizeQuestionType(params: {
  rawType?: string;
  subType?: string;
  sectionTitle?: string;
  stem?: string;
  subject?: string;
}): string {
  const subject = params.subject;
  const rules = rulesForSubject(subject);

  const subType = String(params.subType || "").trim().toLowerCase();
  if (subType && SUB_TYPE_TO_KEY[subType]) return SUB_TYPE_TO_KEY[subType];

  const sectionHaystack = `${params.sectionTitle || ""} ${params.subType || ""}`.trim();
  if (sectionHaystack) {
    const hit = rules.find((rule) => rule.pattern.test(sectionHaystack));
    if (hit) return hit.key;
  }

  const stemHaystack = String(params.stem || "").slice(0, 80);
  if (stemHaystack) {
    const hit = rules.find((rule) => rule.pattern.test(stemHaystack));
    if (hit) return hit.key;
  }

  // AI 直接把标准题型写进了 type 字段（例如 "single_choice" 之外的 "判断题"）
  const rawType = String(params.rawType || "").trim();
  if (rawType) {
    const direct = rules.find((rule) => rule.pattern.test(rawType));
    if (direct) return direct.key;
    const table = getWeightTable(subject);
    if (Object.prototype.hasOwnProperty.call(table, rawType)) return rawType;
  }

  return fallbackTypeForQType(rawType, subject);
}

export function getQuestionWeight(key: string, subject?: string): number {
  const table = getWeightTable(subject);
  const weight = table[key];
  return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

export type ScoreDifficulty = "easy" | "medium" | "hard";

export function getDifficultyFactor(difficulty?: string): number {
  switch (String(difficulty || "").toLowerCase()) {
    case "easy":
      return 0.8;
    case "hard":
      return 1.2;
    default:
      return 1;
  }
}
