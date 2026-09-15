/**
 * 试卷导入自动配分引擎（程序级）。
 *
 * 设计原则（见《试卷导入自动配分整改方案》）：
 * - AI 只负责题型识别、题目拆分、答案识别与"原卷已有分值"识别；
 * - 程序负责判断缺失分值、计算剩余分数、按题型权重两级配分、0.5 标准化、尾差修正与总分强校验；
 * - 人工分值（manual）与原卷明确分值（original）永远不被覆盖；
 * - 无论任何输入，最终 sum(score) 必须严格等于试卷总分。
 */

import {
  getDifficultyFactor,
  getQuestionWeight,
  normalizeQuestionType,
  normalizeSubject,
  type ScoreDifficulty,
} from "./score-weights.js";

export type ScoreSource = "original" | "ai" | "auto" | "manual";

/** 配分引擎可识别的最小题目结构（与业务 Question / ExamQuestionObservation 解耦）。 */
export interface ScorableQuestion {
  questionNumber: number;
  subNumber?: string;
  sectionTitle?: string;
  /** 原始题型文本，可为中文题型名或 single_choice 等枚举。 */
  type?: string;
  /** AI 识别的小题型（方案 16），如 oral_calculation。 */
  subType?: string;
  difficulty?: ScoreDifficulty;
  stem?: string;
  score?: number | null;
  scoreSource?: ScoreSource | null;
}

export interface AutoAssignOptions {
  /** 用户配置的试卷总分；未填写时使用 defaultTotalScore。 */
  totalScore?: number | null;
  /** 未配置总分时的兜底总分，默认 100。 */
  defaultTotalScore?: number;
  /** 学科标识，用于选择题型权重表。 */
  subject?: string;
  /** 最小分值单位，默认 0.5。 */
  step?: number;
  /** 是否启用 AI 难度系数（第一期默认关闭，保证稳定）。 */
  useDifficulty?: boolean;
  /**
   * 兼容历史数据：没有 scoreSource 但 score > 0 时是否视作原卷已有分值。
   * 新导入链路由 AI 显式标记来源，默认 false。
   */
  protectUnmarkedScore?: boolean;
  /** 原卷已有分值超过配置总分时的处理策略，默认采用原卷总分。 */
  onConflict?: "use-identified" | "reassign";
  /** 强制全部重新配分（忽略 original / ai 分值，仅保护 manual）。 */
  forceReassign?: boolean;
}

export interface QuestionAssignment {
  index: number;
  questionNumber: number;
  subNumber?: string;
  weightKey: string;
  weight: number;
  fixed: boolean;
  score: number;
  scoreSource: ScoreSource;
  previousScore: number | null;
}

export interface ScoreSectionSummary {
  sectionKey: string;
  sectionTitle: string;
  questionNumbers: number[];
  count: number;
  totalScore: number;
  weightKeys: string[];
}

export interface ScoreTypeSummary {
  key: string;
  label: string;
  count: number;
  totalScore: number;
}

export interface ScoreConflict {
  identifiedTotalScore: number;
  configuredTotalScore: number;
  message: string;
}

export interface ScoreSummary {
  subject: string;
  /** 用户配置（或默认）的试卷总分。 */
  configuredTotalScore: number;
  /** 实际生效的试卷总分，等于最终 sum(score)。 */
  totalScore: number;
  /** 原卷 / 人工固定分值合计。 */
  fixedScore: number;
  /** 程序自动分配分值合计。 */
  autoScore: number;
  fixedQuestionCount: number;
  autoQuestionCount: number;
  /** 尾差修正涉及的题目数量。 */
  adjustedQuestionCount: number;
  /** 是否因 0.5 分最小单位而对总分做了对齐。 */
  alignedToStep: boolean;
  sections: ScoreSectionSummary[];
  typeStats: ScoreTypeSummary[];
  warnings: string[];
  conflict?: ScoreConflict;
}

export interface AutoAssignResult<T extends ScorableQuestion> {
  questions: T[];
  assignments: QuestionAssignment[];
  summary: ScoreSummary;
}

export const DEFAULT_TOTAL_SCORE = 100;
export const SCORE_STEP = 0.5;

/** 尾差修正优先级：主观题 / 综合题优先吸收 ±0.5 分。 */
const ADJUST_PRIORITY = [
  "作文",
  "写作",
  "探究题",
  "综合题",
  "综合阅读",
  "解决问题",
  "应用题",
  "小练笔",
  "口语交际",
  "计算题",
  "脱式计算",
  "竖式计算",
  "解方程",
  "操作题",
  "作图题",
  "看图题",
  "简答题",
  "阅读理解简答题",
  "阅读简答",
  "阅读理解客观题",
  "填空题",
  "词汇填空",
  "单位换算",
  "选择题",
  "单项选择",
  "单选",
  "判断题",
  "判断",
];

interface InternalItem<T extends ScorableQuestion> {
  index: number;
  question: T;
  key: string;
  weight: number;
  rawScore: number | null;
  source: ScoreSource | null;
  fixed: boolean;
  score: number;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function toFiniteScore(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSource(
  rawSource: unknown,
  rawScore: number | null,
  protectUnmarkedScore: boolean,
): ScoreSource | null {
  const source = String(rawSource ?? "").trim().toLowerCase();
  if (source === "manual" || source === "original" || source === "auto" || source === "ai") {
    return source as ScoreSource;
  }
  if (rawScore !== null && rawScore > 0 && protectUnmarkedScore) return "original";
  return null;
}

/** 将任意分值对齐到 step 网格（0.5 分最小单位）。 */
export function normalizeScore(score: number, step = SCORE_STEP): number {
  if (!Number.isFinite(score)) return 0;
  return round(Math.round(score / step) * step);
}

/** 取大题分组键：同一大题号归为一个大题。 */
function sectionKeyOf(question: ScorableQuestion, index: number): string {
  const number = Number(question.questionNumber);
  if (!Number.isFinite(number) || number <= 0) return `idx_${index}`;
  return `n_${number}`;
}

/**
 * 一级配分：把剩余分值分配到各大题（largest remainder 方法，可整除时优先整数）。
 */
export function allocateSectionScore(sectionWeights: number[], totalUnits: number): number[] {
  if (!sectionWeights.length) return [];
  return distributeUnits(totalUnits, sectionWeights, chooseGrid(totalUnits, sectionWeights.length));
}

/**
 * 二级配分：在大题内部按小题权重分配该大题总分。
 */
export function allocateQuestionScore(questionWeights: number[], sectionUnits: number): number[] {
  if (!questionWeights.length) return [];
  return distributeUnits(sectionUnits, questionWeights, chooseGrid(sectionUnits, questionWeights.length));
}

/** 在给定单位下把总量分配到若干权重上，返回每项单位数（整数）。 */
function distributeUnits(totalUnits: number, weights: number[], grid: 1 | 2): number[] {
  const count = weights.length;
  if (count === 0) return [];
  const safeWeights = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 1));
  const totalWeight = safeWeights.reduce((sum, weight) => sum + weight, 0);
  const raw = safeWeights.map((weight) => (totalUnits * weight) / totalWeight);
  const base = raw.map((value) => Math.floor(value / grid) * grid);
  const assigned = base.reduce((sum, value) => sum + value, 0);
  const leftoverSteps = Math.max(0, Math.round((totalUnits - assigned) / grid));

  const order = raw
    .map((value, index) => ({
      index,
      fraction: value / grid - Math.floor(value / grid),
      weight: safeWeights[index],
    }))
    .sort((a, b) => b.fraction - a.fraction || b.weight - a.weight || a.index - b.index);

  const result = [...base];
  for (let step = 0; step < leftoverSteps && step < count; step += 1) {
    result[order[step % count].index] += grid;
  }
  return result;
}

/** 选择分配网格：条件允许时用 2 个单位（= 1 分）以保证"同一题型每题同分且为整数"。 */
function chooseGrid(totalUnits: number, count: number): 1 | 2 {
  if (count <= 0) return 1;
  if (totalUnits % 2 === 0 && totalUnits >= 2 * count) return 2;
  return 1;
}

function priorityOf(key: string): number {
  const index = ADJUST_PRIORITY.indexOf(key);
  return index < 0 ? ADJUST_PRIORITY.length : index;
}

/**
 * 尾差修正：把 totalScore - sum(score) 的偏差逐步加到/减自优先级最高的题目上。
 * 常规情况下两级配分已经精确，本函数只作为安全兜底。
 */
export function adjustScoreDifference<T extends ScorableQuestion>(
  items: InternalItem<T>[],
  targetTotalScore: number,
  step: number,
): number {
  let adjusted = 0;
  let difference = round(targetTotalScore - items.reduce((sum, item) => sum + item.score, 0));

  while (Math.abs(difference) > 1e-9) {
    const direction = difference > 0 ? 1 : -1;
    const change = direction * step;
    const candidates = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.fixed && (direction > 0 || item.score - step >= step - 1e-9))
      .sort((a, b) => priorityOf(a.item.key) - priorityOf(b.item.key) || a.index - b.index);

    if (!candidates.length) break;
    // 主观题优先，且同一题型内优先调整最后一道（方案 13）。
    const targetPriority = priorityOf(candidates[0].item.key);
    const samePriority = candidates.filter(({ item }) => priorityOf(item.key) === targetPriority);
    const target = samePriority[samePriority.length - 1].item;
    target.score = normalizeScore(target.score + change, step);
    difference = round(difference - change);
    adjusted += 1;
    if (adjusted > items.length * 8) break;
  }

  // 兜底：若分母不是 step 的整数倍（用户填了非 0.5 倍数总分），把剩余误差精确落到最高优先级题目。
  if (Math.abs(difference) > 1e-9) {
    const candidates = items
      .filter((item) => !item.fixed && item.score + difference > 0)
      .sort((a, b) => priorityOf(a.key) - priorityOf(b.key) || a.index - b.index);
    if (candidates.length) {
      candidates[0].score = round(candidates[0].score + difference);
      adjusted += 1;
      difference = 0;
    }
  }

  return adjusted;
}

export interface ValidationResult {
  valid: boolean;
  issues: string[];
}

/** 总分强校验：分值非负、正常题目分值大于 0、总分严格一致。 */
export function validatePaperScore(
  assignments: QuestionAssignment[],
  expectedTotalScore: number,
): ValidationResult {
  const issues: string[] = [];
  const sum = round(assignments.reduce((total, item) => total + item.score, 0));
  if (Math.abs(sum - expectedTotalScore) > 1e-6) {
    issues.push(`题目分值合计 ${sum} 分与试卷总分 ${expectedTotalScore} 分不一致。`);
  }
  const negative = assignments.filter((item) => item.score < 0);
  if (negative.length) {
    issues.push(`存在 ${negative.length} 道题目分值为负数。`);
  }
  const zero = assignments.filter((item) => item.score <= 0);
  if (zero.length) {
    issues.push(`存在 ${zero.length} 道题目未获得分值。`);
  }
  return { valid: issues.length === 0, issues };
}

/** 计算原卷 / 人工固定分值合计。 */
export function calculateFixedScore<T extends ScorableQuestion>(items: InternalItem<T>[]): number {
  return round(items.filter((item) => item.fixed).reduce((sum, item) => sum + (item.rawScore || 0), 0));
}

/** 计算剩余可分配分值。 */
export function calculateRemainingScore(totalScore: number, fixedScore: number): number {
  return round(totalScore - fixedScore);
}

function resolveTargetTotal(options: AutoAssignOptions): number {
  const explicit = toFiniteScore(options.totalScore);
  if (explicit !== null && explicit > 0) return explicit;
  const fallback = toFiniteScore(options.defaultTotalScore);
  return fallback !== null && fallback > 0 ? fallback : DEFAULT_TOTAL_SCORE;
}

/**
 * 自动配分入口。
 * 返回同序的 assignments 与配分摘要，并就地回写每道题的 score / scoreSource。
 */
export function autoAssignPaperScore<T extends ScorableQuestion>(
  questions: T[],
  options: AutoAssignOptions = {},
): AutoAssignResult<T> {
  const step = Number(options.step) > 0 ? Number(options.step) : SCORE_STEP;
  const subject = normalizeSubject(options.subject);
  const configuredTotalScore = resolveTargetTotal(options);
  const protectUnmarkedScore = Boolean(options.protectUnmarkedScore);
  const warnings: string[] = [];

  const targetUnitsRaw = Math.round(configuredTotalScore / step);
  const alignedTotalScore = round(targetUnitsRaw * step);
  const alignedToStep = Math.abs(alignedTotalScore - configuredTotalScore) > 1e-9;
  if (alignedToStep) {
    warnings.push(`试卷总分已对齐到 ${step} 分最小单位：${configuredTotalScore} → ${alignedTotalScore} 分。`);
  }

  const items: InternalItem<T>[] = questions.map((question, index) => {
    const key = normalizeQuestionType({
      rawType: question.type,
      subType: question.subType,
      sectionTitle: question.sectionTitle,
      stem: question.stem,
      subject,
    });
    const baseWeight = getQuestionWeight(key, subject);
    const weight = options.useDifficulty
      ? round(baseWeight * getDifficultyFactor(question.difficulty))
      : baseWeight;
    const rawScore = toFiniteScore(question.score);
    const source = normalizeSource(question.scoreSource, rawScore, protectUnmarkedScore);
    // 只有真正带分值的分值来源才能被保护；人工分值（manual）永远受保护，
    // 强制重新配分（forceReassign）只放弃原卷（original）与 AI 推测分值。
    const protectedSource =
      source === "manual" || (source === "original" && !options.forceReassign);
    const fixed = protectedSource && rawScore !== null && rawScore > 0;
    return {
      index,
      question,
      key,
      weight,
      rawScore,
      source,
      fixed,
      score: fixed ? (rawScore as number) : 0,
    };
  });

  let conflict: ScoreConflict | undefined;
  let effectiveTotalUnits = targetUnitsRaw;
  let fixedScore = calculateFixedScore(items);
  let fixedUnits = Math.round(fixedScore / step);

  if (fixedScore - alignedTotalScore > 1e-9) {
    const message =
      `检测到试卷原有题目分值总计为 ${fixedScore} 分，超过当前设置的试卷总分 ${alignedTotalScore} 分。` +
      `已默认保留原卷分值并使用原试卷总分 ${fixedScore} 分。`;
    conflict = {
      identifiedTotalScore: fixedScore,
      configuredTotalScore: alignedTotalScore,
      message,
    };
    warnings.push(message);
    if (options.onConflict === "reassign") {
      // 教师选择"重新自动配分"：忽略原卷/AI 分值，仅保留人工分值。
      for (const item of items) {
        if (item.fixed && item.source === "manual") continue;
        item.fixed = false;
        item.score = 0;
      }
      fixedScore = calculateFixedScore(items);
      fixedUnits = Math.round(fixedScore / step);
      if (fixedScore - alignedTotalScore > 1e-9) {
        effectiveTotalUnits = fixedUnits;
        warnings.push(`人工固定分值合计 ${fixedScore} 分仍超过配置总分，已按人工分值作为试卷总分。`);
      }
    } else {
      effectiveTotalUnits = fixedUnits;
    }
  }

  let remainingUnits = effectiveTotalUnits - fixedUnits;
  if (remainingUnits < 0) remainingUnits = 0;
  if (remainingUnits > 0 && fixedScore > 0) {
    warnings.push(`识别到原卷已有分值 ${fixedScore} 分，仅对未标注分值的题目分配剩余 ${round(remainingUnits * step)} 分。`);
  }

  const autoItems = items.filter((item) => !item.fixed);
  if (autoItems.length === 0) {
    if (remainingUnits > 0 && fixedScore > 0) {
      warnings.push("所有题目均已具备原卷或人工分值，未执行自动配分。");
    }
  } else if (remainingUnits <= 0) {
    warnings.push("剩余可分配分值为 0，未标注分值的题目暂未配分，请调整试卷总分或手动设置分值。");
    for (const item of autoItems) {
      item.score = 0;
    }
  } else {
    const sections = groupSections(autoItems);
    const sectionUnits = allocateSectionScore(
      sections.map((section) => section.weight),
      remainingUnits,
    );
    sections.forEach((section, sectionIndex) => {
      const units = sectionUnits[sectionIndex];
      const memberUnits = allocateQuestionScore(
        section.members.map((member) => member.weight),
        units,
      );
      section.members.forEach((member, memberIndex) => {
        member.score = round(memberUnits[memberIndex] * step);
      });
    });
  }

  const effectiveTotalScore = round(effectiveTotalUnits * step);
  const adjustedQuestionCount = adjustScoreDifference(items, effectiveTotalScore, step);

  for (const item of items) {
    item.question.score = item.score;
    item.question.scoreSource = item.fixed ? (item.source as ScoreSource) : "auto";
  }

  const assignments = toAssignments(items);
  const validation = validatePaperScore(assignments, effectiveTotalScore);
  warnings.push(...validation.issues);

  const summary = summarizeFromItems(items, {
    subject,
    configuredTotalScore,
    adjustedQuestionCount,
    alignedToStep,
    warnings,
    conflict,
  });

  return { questions, assignments, summary };
}

function toAssignments<T extends ScorableQuestion>(items: InternalItem<T>[]): QuestionAssignment[] {
  return items.map((item) => ({
    index: item.index,
    questionNumber: item.question.questionNumber,
    subNumber: item.question.subNumber,
    weightKey: item.key,
    weight: item.weight,
    fixed: item.fixed,
    score: item.score,
    scoreSource: (item.question.scoreSource ?? (item.fixed ? item.source : "auto")) as ScoreSource,
    previousScore: item.rawScore,
  }));
}

interface SummaryExtras {
  subject: string;
  configuredTotalScore: number;
  adjustedQuestionCount?: number;
  alignedToStep?: boolean;
  warnings?: string[];
  conflict?: ScoreConflict;
}

function summarizeFromItems<T extends ScorableQuestion>(
  items: InternalItem<T>[],
  extras: SummaryExtras,
): ScoreSummary {
  const assignments = toAssignments(items);
  return {
    subject: extras.subject,
    configuredTotalScore: extras.configuredTotalScore,
    totalScore: round(assignments.reduce((sum, item) => sum + item.score, 0)),
    fixedScore: round(assignments.filter((item) => item.fixed).reduce((sum, item) => sum + item.score, 0)),
    autoScore: round(assignments.filter((item) => !item.fixed).reduce((sum, item) => sum + item.score, 0)),
    fixedQuestionCount: assignments.filter((item) => item.fixed).length,
    autoQuestionCount: assignments.filter((item) => !item.fixed).length,
    adjustedQuestionCount: extras.adjustedQuestionCount || 0,
    alignedToStep: Boolean(extras.alignedToStep),
    sections: buildSectionSummaries(items),
    typeStats: buildTypeStats(assignments),
    warnings: extras.warnings || [],
    conflict: extras.conflict,
  };
}

/**
 * 仅根据当前题目分值重新汇总配分摘要（不重新分配）。
 * 用于教师手工修改某题分值后刷新试卷级统计。
 */
export function summarizePaperScore<T extends ScorableQuestion>(
  questions: T[],
  options: {
    subject?: string;
    configuredTotalScore?: number;
    useDifficulty?: boolean;
    step?: number;
  } = {},
): ScoreSummary {
  const subject = normalizeSubject(options.subject);
  const items: InternalItem<T>[] = questions.map((question, index) => {
    const key = normalizeQuestionType({
      rawType: question.type,
      subType: question.subType,
      sectionTitle: question.sectionTitle,
      stem: question.stem,
      subject,
    });
    const baseWeight = getQuestionWeight(key, subject);
    const weight = options.useDifficulty
      ? round(baseWeight * getDifficultyFactor(question.difficulty))
      : baseWeight;
    const rawScore = toFiniteScore(question.score);
    const source = normalizeSource(question.scoreSource, rawScore, false);
    return {
      index,
      question,
      key,
      weight,
      rawScore,
      source,
      fixed: source === "manual" || source === "original",
      score: rawScore ?? 0,
    };
  });
  return summarizeFromItems(items, {
    subject,
    configuredTotalScore:
      toFiniteScore(options.configuredTotalScore) !== null && Number(options.configuredTotalScore) > 0
        ? Number(options.configuredTotalScore)
        : round(items.reduce((sum, item) => sum + item.score, 0)),
  });
}

/** 依据题目最终分值，把采分步骤分值按比例重算到同一满分（方案 15/21 的程序兜底）。 */
export function rescaleRubricSteps<T extends { score: number }>(
  steps: T[],
  targetScore: number,
  step = SCORE_STEP,
): T[] {
  if (!steps.length) return steps;
  const total = round(steps.reduce((sum, item) => sum + (Number(item.score) || 0), 0));
  if (Math.abs(total - targetScore) < 1e-9) return steps;
  const units = Math.max(1, Math.round(targetScore / step));
  const weights = steps.map((item) => ((Number(item.score) || 0) > 0 ? Number(item.score) : 1));
  const unitsList = distributeUnits(units, weights, chooseGrid(units, steps.length));
  const next = steps.map((item, index) => ({ ...item, score: round(unitsList[index] * step) }));
  const difference = round(targetScore - next.reduce((sum, item) => sum + item.score, 0));
  if (Math.abs(difference) > 1e-9) {
    next[next.length - 1].score = round(next[next.length - 1].score + difference);
  }
  return next;
}

function groupSections<T extends ScorableQuestion>(items: InternalItem<T>[]) {
  const map = new Map<string, InternalItem<T>[]>();
  for (const item of items) {
    const key = sectionKeyOf(item.question, item.index);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return [...map.entries()].map(([key, members]) => ({
    key,
    members,
    weight: members.reduce((sum, member) => sum + member.weight, 0),
  }));
}

function buildSectionSummaries<T extends ScorableQuestion>(items: InternalItem<T>[]): ScoreSectionSummary[] {
  const map = new Map<string, InternalItem<T>[]>();
  for (const item of items) {
    const key = sectionKeyOf(item.question, item.index);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return [...map.entries()].map(([key, members]) => ({
    sectionKey: key,
    sectionTitle:
      members.find((member) => member.question.sectionTitle)?.question.sectionTitle ||
      members[0].key,
    questionNumbers: [...new Set(members.map((member) => member.question.questionNumber))],
    count: members.length,
    totalScore: round(members.reduce((sum, member) => sum + member.score, 0)),
    weightKeys: [...new Set(members.map((member) => member.key))],
  }));
}

function buildTypeStats(assignments: QuestionAssignment[]): ScoreTypeSummary[] {
  const map = new Map<string, ScoreTypeSummary>();
  for (const assignment of assignments) {
    const existing = map.get(assignment.weightKey);
    if (existing) {
      existing.count += 1;
      existing.totalScore = round(existing.totalScore + assignment.score);
    } else {
      map.set(assignment.weightKey, {
        key: assignment.weightKey,
        label: assignment.weightKey,
        count: 1,
        totalScore: round(assignment.score),
      });
    }
  }
  return [...map.values()];
}
