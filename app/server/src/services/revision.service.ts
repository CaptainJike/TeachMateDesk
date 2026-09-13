import { store, type RevisionLog, type GradingDetail } from "../db/store.js";
import { ChineseExpertAgent, FileBasedRetriever } from "@teachmate/agent-engine";

const OBJECTIVE_QUESTION_TYPES = new Set(["SINGLE_CHOICE", "MULTI_CHOICE", "JUDGE"]);

class RevisionRequestError extends Error {
  public readonly statusCode = 400;
}

export const isRevisionEligible = (detail: Pick<GradingDetail, "question_type" | "final_score" | "max_score">) =>
  !OBJECTIVE_QUESTION_TYPES.has((detail.question_type || "").toUpperCase()) &&
  detail.final_score < detail.max_score;

export class RevisionService {
  constructor(private retriever: FileBasedRetriever) {}

  public async submitRevision(params: {
    submissionId: string;
    gradingDetailId: string;
    revisedAnswer: string;
  }): Promise<{
    gradingDetail: GradingDetail;
    revisionLog: RevisionLog;
    newScore: number;
    deltaScore: number;
  }> {
    const submission = store.submissions.get(params.submissionId);
    if (!submission) throw new Error(`Submission ${params.submissionId} not found`);

    const detail = submission.grading_details.find((d) => d.id === params.gradingDetailId);
    if (!detail) throw new Error(`Grading detail ${params.gradingDetailId} not found`);
    if (!isRevisionEligible(detail)) {
      if (OBJECTIVE_QUESTION_TYPES.has((detail.question_type || "").toUpperCase())) {
        throw new RevisionRequestError("选择题、判断题已按标准答案直接判分，无需提交二次订正");
      }
      throw new RevisionRequestError("本题已经满分，无需提交二次订正");
    }
    if (!params.revisedAnswer?.trim()) {
      throw new RevisionRequestError("二次订正作答不能为空");
    }

    const exam = store.exams.get(submission.exam_id);
    const question = exam?.questions.find((q) => q.id === detail.question_id);

    // A revision is an independent grading session. Never reuse the Agent
    // because its message history belongs to a previous revision/student.
    const agent = new ChineseExpertAgent(
      this.retriever,
      exam?.school_stage || "MIDDLE",
      "TIER_2_STANDARD"
    );
    const regradeRes = await agent.gradeQuestion({
      questionTitle: `第 ${detail.question_num} 题订正`,
      questionType: detail.question_type,
      stem: detail.stem_text,
      options: question?.options,
      maxScore: detail.max_score,
      rubricSteps: question?.standard_answer?.rubric_steps,
      referenceAnswer: question?.standard_answer?.correct_answer || "",
      standardAnswerTeacherEdited: question?.standard_answer?.is_teacher_edited,
      studentAnswer: params.revisedAnswer,
      school_stage: exam?.school_stage || "MIDDLE",
      isRevision: true,
      previousScore: detail.final_score,
      previousFeedback: detail.ai_feedback,
      previousAnswerEvidence: detail.student_evidence?.join(" ") || "",
    });

    const oldScore = detail.final_score;
    const newScore = regradeRes.totalAwardedScore;
    const deltaScore = newScore - oldScore;

    // Update Detail
    detail.final_score = newScore;
    detail.ai_score = newScore;
    detail.student_answer = params.revisedAnswer;
    detail.step_details = regradeRes.stepEvaluations;
    detail.score_status =
      newScore === detail.max_score
        ? "FULL_CORRECT"
        : newScore > 0
        ? "PARTIAL_CORRECT"
        : "WRONG";
    detail.ai_feedback = regradeRes.overallSummary;

    // Update Submission total score. Keep ai_score in sync because the
    // revision is the latest machine-generated score shown to the teacher.
    submission.total_score = submission.grading_details.reduce((acc, d) => acc + d.final_score, 0);
    submission.ai_score = submission.total_score;

    const revisionLog: RevisionLog = {
      id: `rev_${Date.now()}`,
      grading_detail_id: detail.id,
      revision_round: (detail.revision_logs?.length || 0) + 1,
      revised_answer: params.revisedAnswer,
      new_score: newScore,
      feedback:
        newScore > oldScore
          ? `订正成功！得分提升至 ${newScore}/${detail.max_score} 分。${regradeRes.overallSummary}`
          : `本次订正评分为 ${newScore}/${detail.max_score} 分。${regradeRes.overallSummary}`,
      revised_at: new Date().toISOString(),
    };

    if (!detail.revision_logs) {
      detail.revision_logs = [];
    }
    detail.revision_logs.push(revisionLog);
    // Persist both the revised answer and its score. Without this, the API
    // response looked correct but a refresh restored the old database value.
    store.persist();

    return {
      gradingDetail: detail,
      revisionLog,
      newScore,
      deltaScore,
    };
  }
}
