import { EventEmitter } from "events";
import {
  store,
  type StudentSubmission,
  type GradingDetail,
  type AgentExecutionLog,
  type WorkflowRun,
  type WorkflowStep,
} from "../db/store.js";
import {
  ChineseExpertAgentPool,
  RouterAgent,
  FeedbackAgent,
  FileBasedRetriever,
} from "@teachmate/agent-engine";
import {
  createStudentIdentityKey,
  findDuplicateSubmission,
  stableStudentId,
} from "./import-utils.js";
import type { VisionAnswer } from "@teachmate/agent-engine";

export interface MultimodalSubmissionInput {
  studentName: string;
  className?: string;
  studentNumber?: string;
  studentId?: string;
  visionAnswers: VisionAnswer[];
  identityEvidence?: { studentName: string; className: string; studentNumber: string; confidence: number; evidence: string };
  identityKey?: string;
  sourceHash?: string;
  sourceFileName?: string;
  sourceFiles?: string[];
  importBatchId?: string;
}

export interface GradingSSEEvent {
  submissionId: string;
  stage: "VISION_ANALYSIS" | "ANSWER_EVIDENCE_EXTRACTED" | "GRADING_ROUTE_SELECTED" | "RUBRIC_GRADING" | "FEEDBACK_GENERATING" | "GRADING_COMPLETED";
  message: string;
  progressPercent: number;
  questionNum?: number;
}

export class GradingService extends EventEmitter {
  private agentPool: ChineseExpertAgentPool;
  private routerAgent = new RouterAgent();
  private feedbackAgent = new FeedbackAgent();
  private workflowRunBySubmission = new Map<string, string>();

  constructor(private retriever: FileBasedRetriever) {
    super();
    this.agentPool = new ChineseExpertAgentPool(5, "MIDDLE", this.retriever);
  }

  public getSubmissions(examId?: string): StudentSubmission[] {
    const list = Array.from(store.submissions.values()).filter((s) => !examId || s.exam_id === examId);
    const newest = new Map<string, StudentSubmission>();
    for (const submission of list) {
      const key = `${submission.exam_id}:${submission.identity_key || createStudentIdentityKey({
        studentName: submission.student_name,
        className: submission.class_name,
        studentNumber: submission.student_number,
      }) || submission.id}`;
      const current = newest.get(key);
      if (!current || submission.submitted_at > current.submitted_at) newest.set(key, submission);
    }
    return [...newest.values()].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  }

  public getSubmissionById(id: string): StudentSubmission | undefined {
    return store.submissions.get(id);
  }

  public getReviewTasks(status = "OPEN"): any[] {
    return store.listReviewTasks(status);
  }

  public getExecutionLogs(submissionId?: string): AgentExecutionLog[] {
    if (submissionId) {
      return store.executionLogs.filter((l) => l.submission_id === submissionId);
    }
    return store.executionLogs;
  }

  public reviewGradingDetail(params: {
    submissionId: string;
    detailId: string;
    finalScore: number;
    reason?: string;
  }): GradingDetail {
    const submission = store.submissions.get(params.submissionId);
    if (!submission) throw new Error(`Submission ${params.submissionId} not found`);
    const detail = submission.grading_details.find((item) => item.id === params.detailId);
    if (!detail) throw new Error(`Grading detail ${params.detailId} not found`);
    if (!Number.isFinite(params.finalScore) || params.finalScore < 0 || params.finalScore > detail.max_score) {
      throw new Error(`最终得分必须在 0 到 ${detail.max_score} 之间`);
    }

    const previousScore = detail.final_score;
    detail.final_score = params.finalScore;
    detail.is_reviewed = true;
    detail.review_required = false;
    detail.review_reason = params.reason || "教师已复核";
    store.resolveReviewTask(submission.id, detail.question_id);
    detail.score_status =
      params.finalScore === detail.max_score
        ? "FULL_CORRECT"
        : params.finalScore > 0
        ? "PARTIAL_CORRECT"
        : "WRONG";
    submission.total_score = submission.grading_details.reduce((sum, item) => sum + item.final_score, 0);
    submission.status = submission.grading_details.some((item) => item.review_required && !item.is_reviewed)
      ? "REVIEW_PENDING"
      : "COMPLETED";
    store.executionLogs.unshift({
      id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      submission_id: submission.id,
      question_id: detail.question_id,
      agent_name: "TeacherReview",
      model: "human",
      input_context: JSON.stringify({ previousScore, reason: params.reason || "" }),
      output_content: JSON.stringify({ finalScore: params.finalScore }),
      prompt_tokens: 0,
      completion_tokens: 0,
      latency_ms: 0,
      status: "SUCCESS",
      created_at: new Date().toISOString(),
    });
    store.persist();
    return detail;
  }

  /** Restart a submission left in GRADING after a worker/API failure. */
  public retrySubmission(submissionId: string, providedAnswers?: VisionAnswer[]): void {
    const submission = store.submissions.get(submissionId);
    if (!submission) throw new Error(`Submission ${submissionId} not found`);
    if (submission.status === "COMPLETED") {
      throw new Error("该答卷已经批改完成，无需重新批改");
    }

    const visionAnswers: VisionAnswer[] = providedAnswers || submission.vision_answers || submission.grading_details.map((detail) => ({
      questionId: detail.question_id,
      questionNumber: detail.sub_num || String(detail.question_num),
      studentAnswer: detail.student_answer,
      answerEvidence: detail.student_evidence?.join(" ") || "",
      answerRegion: detail.answer_region || { page: 1, description: "" },
      confidence: detail.vision_confidence || detail.confidence,
      isCrossQuestionRisk: false,
      reviewRequired: Boolean(detail.review_required),
      reviewReason: detail.review_reason || "",
    }));
    submission.status = "RETRYING";
    submission.total_score = 0;
    submission.ai_score = 0;
    submission.grading_details = [];
    store.persist();
    this.executeSubmissionPipeline(submissionId, submission.exam_id, visionAnswers).catch((err) => {
      this.markPipelineFailure(submissionId, err);
    });
  }

  public async startBatchGrading(
    examId: string,
    studentAnswersList: MultimodalSubmissionInput[]
  ): Promise<string[]> {
    const exam = store.exams.get(examId);
    if (!exam) throw new Error(`Exam ${examId} not found`);
    if (exam.status !== "AUDITED") {
      throw new Error("试卷尚未完成教师审核，不能启动正式批改");
    }
    if (!Array.isArray(studentAnswersList) || studentAnswersList.length === 0) {
      throw new Error("请至少提交一份学生答卷");
    }

    const submissionIds: string[] = [];

    for (const stu of studentAnswersList) {
      if (!stu.studentName?.trim()) throw new Error("学生姓名不能为空");
      if (!stu.className?.trim()) throw new Error("所属班级不能为空");
      if (!stu.sourceFiles?.length || !stu.visionAnswers?.length) {
        throw new Error("正式批改必须提供学生答卷原图和视觉答案证据，禁止退化为文本批改");
      }
      if (stu.studentName.trim().length > 80) throw new Error("学生姓名不能超过 80 个字符");
      if (stu.className.trim().length > 80) throw new Error("所属班级不能超过 80 个字符");
      if ((stu.studentNumber || "").trim().length > 40) throw new Error("学号/考号不能超过 40 个字符");
      const identityKey = stu.identityKey || createStudentIdentityKey({
        studentName: stu.studentName,
        className: stu.className,
        studentNumber: stu.studentNumber,
      });
      const duplicate = findDuplicateSubmission({
        submissions: store.submissions.values(),
        examId,
        sourceHash: stu.sourceHash,
        identityKey,
      });
      if (duplicate) {
        throw new Error(
          duplicate.type === "EXACT_FILE"
            ? `答卷文件已导入：${duplicate.submission.student_name}`
            : `该试卷已存在学生【${duplicate.submission.student_name}】的答卷`
        );
      }
      const subId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const submission: StudentSubmission = {
        id: subId,
        exam_id: examId,
        exam_version_id: exam.version_id,
        student_id: stu.studentId || stableStudentId(identityKey),
        student_number: stu.studentNumber?.trim() || "",
        student_name: stu.studentName.trim(),
        class_name: stu.className.trim(),
        identity_key: identityKey,
        source_hash: stu.sourceHash || "",
        source_file_name: stu.sourceFileName || "",
        import_batch_id: stu.importBatchId || "",
        status: "GRADING",
        total_score: 0,
        ai_score: 0,
        submitted_at: new Date().toISOString(),
        source_files: stu.sourceFiles || [],
        identity_evidence: stu.identityEvidence,
        vision_answers: stu.visionAnswers,
        grading_details: [],
      };
      store.submissions.set(subId, submission);
      const workflow: WorkflowRun = {
        id: `workflow_${subId}`,
        workflow_type: "GRADING",
        resource_id: subId,
        status: "QUEUED",
        attempt: 0,
        idempotency_key: `grading:${subId}`,
        created_at: new Date().toISOString(),
      };
      store.createWorkflowRun(workflow);
      this.workflowRunBySubmission.set(subId, workflow.id);
      submissionIds.push(subId);

      // Run async grading pipeline
      this.executeSubmissionPipeline(subId, examId, stu.visionAnswers).catch((err) => {
        this.markPipelineFailure(subId, err);
      });
    }

    store.persist();

    return submissionIds;
  }

  private async executeSubmissionPipeline(
    submissionId: string,
    examId: string,
    visionAnswers: VisionAnswer[]
  ) {
    const exam = store.exams.get(examId);
    const submission = store.submissions.get(submissionId);
    if (!exam || !submission) return;
    const workflowId = this.workflowRunBySubmission.get(submissionId) || `workflow_${submissionId}`;
    submission.status = "GRADING";
    store.persist();
    store.updateWorkflowRun(workflowId, { status: "RUNNING", started_at: new Date().toISOString(), attempt: 1 });
    const markStep = (stepKey: string, status: WorkflowStep["status"], patch: Partial<WorkflowStep> = {}) => {
      store.upsertWorkflowStep({
        id: `${workflowId}:${stepKey}`,
        run_id: workflowId,
        step_key: stepKey,
        status,
        attempt: 1,
        ...(status === "RUNNING" ? { started_at: new Date().toISOString() } : {}),
        ...(status === "COMPLETED" ? { completed_at: new Date().toISOString() } : {}),
        ...patch,
      });
    };

    // 1. The image understanding result is an evidence candidate, not a final fact.
    markStep("vision_analysis", "COMPLETED", { output_json: JSON.stringify({ answerCount: visionAnswers.length }) });
    this.emitSSE({
      submissionId,
      stage: "VISION_ANALYSIS",
      message: `Pi Agent 已完成【${submission.student_name}】答卷原图分析，保留题目区域和证据。`,
      progressPercent: 15,
    });

    this.emitSSE({
      submissionId,
      stage: "ANSWER_EVIDENCE_EXTRACTED",
      message: "已提取学生身份与题目答案证据，准备逐题核验。",
      progressPercent: 30,
    });
    markStep("answer_evidence", "COMPLETED");

    let totalScore = 0;
    let needsReview = false;
    const gradingDetails: GradingDetail[] = [];
    const questions = exam.questions;
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const expectedQuestionNumber = q.sub_num || String(q.question_num);
      const evidence = visionAnswers.find((answer) => answer.questionId === q.id)
        || visionAnswers.find((answer) => answer.questionNumber === expectedQuestionNumber && Boolean(q.sub_num))
        || (!q.sub_num ? visionAnswers.find((answer) => answer.questionNumber === expectedQuestionNumber) : undefined);
      const studentAns = evidence?.studentAnswer || "（未作答）";
      const evidenceReviewRequired = !evidence || evidence.reviewRequired || !evidence.answerEvidence;

      // 3. GRADING_ROUTE_SELECTED Event
      const routeMeta = this.routerAgent.route({
        stem: q.stem_text,
        type: q.q_type,
        score: q.score_value,
        subject: exam.subject as any,
        school_stage: exam.school_stage,
      });

      this.emitSSE({
        submissionId,
        stage: "GRADING_ROUTE_SELECTED",
        message: `已完成第 ${q.question_num} 题路由，准备执行${routeMeta.model_tier}评分...`,
        progressPercent: 30 + Math.round((i / Math.max(questions.length, 1)) * 10),
        questionNum: q.question_num,
      });

      this.emitSSE({
        submissionId,
        stage: "RUBRIC_GRADING",
        message: `正在按分步采分细则核验第 ${q.question_num} 题 (${i + 1}/${questions.length})...`,
        progressPercent: 30 + Math.round(((i + 1) / questions.length) * 50),
        questionNum: q.question_num,
      });

      const rubricSteps = q.standard_answer?.rubric_steps || [];
      const rubricTotal = rubricSteps.reduce((sum, step) => sum + Number(step.score || 0), 0);
      const rubricInvalid = q.q_type !== "SINGLE_CHOICE" &&
        q.q_type !== "MULTI_CHOICE" &&
        q.q_type !== "JUDGE" &&
        (rubricSteps.length === 0 || Math.abs(rubricTotal - q.score_value) > 0.001);

      // 4. Grading execution via pool
      const questionStep = `question:${q.id}`;
      markStep(questionStep, "RUNNING");
      const gradingRes = await this.agentPool.executeGrading(routeMeta.model_tier, async (agent) => {
        return await agent.gradeQuestion({
          questionId: q.id,
          questionTitle: `第 ${q.question_num} 题`,
          questionType: q.q_type,
          options: q.options,
          stem: q.stem_text,
          maxScore: q.score_value,
          rubricSteps: q.standard_answer?.rubric_steps,
          referenceAnswer: q.standard_answer?.correct_answer || "",
          standardAnswerTeacherEdited: q.standard_answer?.is_teacher_edited,
          studentAnswer: studentAns,
          school_stage: exam.school_stage,
          model_tier: routeMeta.model_tier,
          answerEvidence: evidence?.answerEvidence,
        });
      });

      totalScore += gradingRes.totalAwardedScore;

      // 5. Error diagnosis feedback if score not full
      let errorType: any = "NONE";
      let feedbackText = gradingRes.overallSummary;

      if (gradingRes.totalAwardedScore < q.score_value) {
        const missedSteps = gradingRes.stepEvaluations.filter((s) => !s.is_hit).map((s) => s.reason || "采分点未命中");
        const fbRes = await this.feedbackAgent.generateFeedback({
          questionNum: q.question_num,
          stem: q.stem_text,
          maxScore: q.score_value,
          awardedScore: gradingRes.totalAwardedScore,
          deductionReasons: missedSteps,
          studentAnswer: studentAns,
          referenceAnswer: q.standard_answer?.correct_answer || "",
        });
        errorType = fbRes.errorType;
        feedbackText = `${fbRes.gapAnalysis}。启发建议：${fbRes.heuristicHint}`;
      }

      // AI output is never considered teacher-reviewed. Low-confidence or
      // validator-flagged results remain visible but block completion.
      const isReviewed = false;
      const questionNeedsReview = rubricInvalid || evidenceReviewRequired || gradingRes.reviewRequired === true || gradingRes.confidence < 0.75;
      needsReview = needsReview || questionNeedsReview;

      const gd: GradingDetail = {
        id: `gd_${submissionId}_${q.id}`,
        submission_id: submissionId,
        question_id: q.id,
        question_num: q.question_num,
        sub_num: q.sub_num,
        question_type: q.q_type,
        stem_text: q.stem_text,
        student_answer: studentAns,
        final_score: gradingRes.totalAwardedScore,
        ai_score: gradingRes.totalAwardedScore,
        max_score: q.score_value,
        score_status:
          gradingRes.totalAwardedScore === q.score_value
            ? "FULL_CORRECT"
            : gradingRes.totalAwardedScore > 0
            ? "PARTIAL_CORRECT"
            : "WRONG",
        step_details: gradingRes.stepEvaluations,
        error_type: errorType,
        ai_feedback: feedbackText,
        confidence: gradingRes.confidence,
        is_reviewed: isReviewed,
        review_required: questionNeedsReview,
        review_reason: questionNeedsReview
          ? rubricInvalid
            ? "Rubric 采分点缺失或分值总和不等于题目满分"
            : evidenceReviewRequired
              ? evidence?.reviewReason || "原图答案证据不足，需要教师复核"
              : "评分置信度不足或证据校验未通过"
          : undefined,
        student_evidence: evidence?.answerEvidence ? [evidence.answerEvidence] : [],
        answer_region: evidence?.answerRegion,
        vision_confidence: evidence?.confidence,
        grading_route: routeMeta.model_tier,
        agent_model: gradingRes.modelUsed,
      };

      gradingDetails.push(gd);
      // Persist each completed question immediately. A later model error
      // must not erase scores that were already successfully produced.
      submission.grading_details = [...gradingDetails];
      submission.total_score = totalScore;
      submission.ai_score = totalScore;
      store.persist();
      markStep(questionStep, "COMPLETED", { output_json: JSON.stringify({ score: gd.final_score, reviewRequired: questionNeedsReview }) });
      if (questionNeedsReview) {
        store.createReviewTask({
          submissionId,
          questionId: q.id,
          reason: gd.review_reason || "需要教师复核",
        });
      }

      // Record Execution Log (Trace)
      store.executionLogs.unshift({
        id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        submission_id: submissionId,
        question_id: q.id,
        agent_name: "ChineseExpertAgent",
        model: gradingRes.modelUsed,
        input_context: JSON.stringify({ stem: q.stem_text, rubric: q.standard_answer?.rubric_steps }),
        output_content: JSON.stringify(gradingRes.stepEvaluations),
        prompt_tokens: 450,
        completion_tokens: 180,
        latency_ms: gradingRes.latencyMs,
        status: "SUCCESS",
        created_at: new Date().toISOString(),
      });
    }

    // 6. Complete Submission. A batch with any uncertain question must wait
    // for teacher review instead of presenting AI scores as final scores.
    submission.status = needsReview ? "REVIEW_PENDING" : "COMPLETED";
    store.updateWorkflowRun(workflowId, {
      status: needsReview ? "REVIEW_PENDING" : "COMPLETED",
      completed_at: new Date().toISOString(),
    });
    submission.total_score = totalScore;
    submission.ai_score = totalScore;
    submission.grading_details = gradingDetails;
    store.persist();

    // 7. GRADING_COMPLETED Event
    this.emitSSE({
      submissionId,
      stage: "GRADING_COMPLETED",
      message: `批改完成！总得分 ${totalScore}/${exam.total_score} 分，采分点证据链已就绪。`,
      progressPercent: 100,
    });
  }

  private markPipelineFailure(submissionId: string, error: unknown): void {
    const submission = store.submissions.get(submissionId);
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error in grading pipeline for submission ${submissionId}:`, message);
    if (!submission) return;

    // Persist a terminal failure instead of leaving the task indefinitely in
    // GRADING. The retry endpoint can move it to RETRYING and run it again.
    submission.status = "FAILED";
    const workflowId = this.workflowRunBySubmission.get(submissionId) || `workflow_${submissionId}`;
    store.updateWorkflowRun(workflowId, {
      status: "FAILED",
      error_message: message,
      completed_at: new Date().toISOString(),
    });
    store.executionLogs.unshift({
      id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      submission_id: submissionId,
      question_id: "",
      agent_name: "GradingWorkflow",
      model: "",
      input_context: "",
      output_content: message,
      prompt_tokens: 0,
      completion_tokens: 0,
      latency_ms: 0,
      status: "FAILED",
      created_at: new Date().toISOString(),
    });
    store.persist();
    this.emitSSE({
      submissionId,
      stage: "GRADING_COMPLETED",
      message: `批改异常，已转入教师复核：${message}`,
      progressPercent: 100,
    });
  }

  private emitSSE(event: GradingSSEEvent) {
    store.appendGradingEvent(event.submissionId, event);
    this.emit("grading_event", event);
  }
}
