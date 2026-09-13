import { store, type GradingDetail, type StudentSubmission } from "../db/store.js";

export const DIAGNOSTIC_ERROR_TYPES = [
  "KNOWLEDGE_GAP",
  "LOGIC_STEP_MISSING",
  "EXPRESSION_BIAS",
  "CALC_ERROR",
] as const;

export type DiagnosticErrorType = (typeof DIAGNOSTIC_ERROR_TYPES)[number];
export type ErrorTypeBreakdown = Record<DiagnosticErrorType, number>;

const ANALYZABLE_SUBMISSION_STATUSES = new Set<StudentSubmission["status"]>([
  "COMPLETED",
  "REVIEW_PENDING",
]);

function createEmptyErrorTypeBreakdown(): ErrorTypeBreakdown {
  return DIAGNOSTIC_ERROR_TYPES.reduce((breakdown, type) => {
    breakdown[type] = 0;
    return breakdown;
  }, {} as ErrorTypeBreakdown);
}

/**
 * Aggregate diagnoses that were actually persisted by the grading pipeline.
 *
 * A diagnosis is only meaningful for a question that lost points. In
 * particular, a teacher can turn an AI partial score into a full score during
 * review; keeping the old error_type in that case would make the class chart
 * report an error that no longer exists in the final result. Unknown/missing
 * types are deliberately ignored instead of being guessed from the answer.
 */
export function aggregateErrorTypeBreakdown(details: GradingDetail[]): {
  breakdown: ErrorTypeBreakdown;
  total: number;
} {
  const breakdown = createEmptyErrorTypeBreakdown();

  for (const detail of details) {
    const errorType = detail.error_type;
    const finalScore = Number(detail.final_score);
    const maxScore = Number(detail.max_score);
    const hasLostPoints = Number.isFinite(finalScore)
      && Number.isFinite(maxScore)
      && finalScore < maxScore;

    if (!hasLostPoints || !errorType || errorType === "NONE") continue;
    if (!Object.prototype.hasOwnProperty.call(breakdown, errorType)) continue;
    breakdown[errorType as DiagnosticErrorType] += 1;
  }

  return {
    breakdown,
    total: DIAGNOSTIC_ERROR_TYPES.reduce((sum, type) => sum + breakdown[type], 0),
  };
}

function hasPersistedGradingResult(submission: StudentSubmission): boolean {
  return ANALYZABLE_SUBMISSION_STATUSES.has(submission.status) && submission.grading_details.length > 0;
}

export class AnalyticsService {
  public getClassAnalytics(examId: string, className?: string) {
    const exam = store.exams.get(examId);
    const allExamSubmissions = Array.from(store.submissions.values()).filter((s) => s.exam_id === examId);
    // Only include submissions with persisted grading output. This excludes
    // imported/queued/failed work and prevents an in-progress batch from
    // appearing as a complete class statistic.
    const analyzedExamSubmissions = allExamSubmissions.filter(hasPersistedGradingResult);

    // 仅展示已有持久化批改结果的班级，避免筛选器出现空数据班级。
    const classSet = new Set<string>();
    analyzedExamSubmissions.forEach((s) => {
      if (s.class_name) classSet.add(s.class_name);
    });
    const classList = Array.from(classSet);

    let submissions = analyzedExamSubmissions;
    if (className && className !== "ALL") {
      submissions = analyzedExamSubmissions.filter((s) => s.class_name === className);
    }

    if (!exam || submissions.length === 0) {
      return {
        classList,
        selectedClass: className || "ALL",
        totalStudents: 0,
        totalExamScore: exam?.total_score || 0,
        averageScore: 0,
        highestScore: 0,
        lowestScore: 0,
        scoreDistribution: [],
        questionAccuracy: [],
        errorTypeBreakdown: createEmptyErrorTypeBreakdown(),
        errorTypeTotal: 0,
        rubricCoverageRate: 0,
      };
    }

    const scores = submissions.map((s) => s.total_score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const max = Math.max(...scores);
    const min = Math.min(...scores);

    // Distribution
    const dist = [
      { range: "90-100%", count: scores.filter((s) => s >= exam.total_score * 0.9).length },
      { range: "80-89%", count: scores.filter((s) => s >= exam.total_score * 0.8 && s < exam.total_score * 0.9).length },
      { range: "60-79%", count: scores.filter((s) => s >= exam.total_score * 0.6 && s < exam.total_score * 0.8).length },
      { range: "<60%", count: scores.filter((s) => s < exam.total_score * 0.6).length },
    ];

    // Question Accuracy
    const questionAccuracy = exam.questions.map((q) => {
      let earned = 0;
      let total = 0;
      submissions.forEach((s) => {
        const d = s.grading_details.find((detail) => detail.question_id === q.id);
        if (d) {
          const finalScore = Number(d.final_score);
          const maxScore = Number(d.max_score);
          if (!Number.isFinite(finalScore) || !Number.isFinite(maxScore) || maxScore <= 0) return;
          earned += finalScore;
          total += maxScore;
        }
      });
      const rate = total > 0 ? Math.round((earned / total) * 100) : 0;
      return {
        questionNum: q.question_num,
        questionType: q.q_type,
        scoreValue: q.score_value,
        accuracyRate: rate,
      };
    });

    // Error Type Breakdown. Use the final persisted scores and the diagnosis
    // emitted by the grading pipeline; never infer a category in analytics.
    const allDetails = submissions.flatMap((s) => s.grading_details);
    const { breakdown: errorTypes, total: errorTypeTotal } = aggregateErrorTypeBreakdown(allDetails);
    const allSteps = allDetails
      .filter((detail) => detail.question_type === "SUBJECTIVE_SHORT" || detail.question_type === "ESSAY")
      .flatMap((detail) => detail.step_details || []);
    const rubricCoverageRate = allSteps.length > 0
      ? Math.round((allSteps.filter((step) => step.is_hit).length / allSteps.length) * 1000) / 10
      : 0;

    return {
      classList,
      selectedClass: className || "ALL",
      totalStudents: submissions.length,
      totalExamScore: exam.total_score,
      averageScore: Math.round(avg * 10) / 10,
      highestScore: max,
      lowestScore: min,
      scoreDistribution: dist,
      questionAccuracy,
      errorTypeBreakdown: errorTypes,
      errorTypeTotal,
      rubricCoverageRate,
    };
  }
}
