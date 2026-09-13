import { store, type ExamPaper, type Question, type StandardAnswer } from "../db/store.js";
import {
  DocumentAgent,
  QuestionParserAgent,
  RubricAgent,
  RouterAgent,
  FileBasedRetriever,
  inferSingleChoiceAnswer,
} from "@teachmate/agent-engine";
import { assertLikelyExamDocument } from "./exam-import-validation.js";
import type { ExamQuestionObservation, VisionPageEvidence } from "@teachmate/agent-engine";

function normalizeSubNumber(questionNumber: number, subNumber?: string): string | undefined {
  const clean = String(subNumber || "").trim().replace(/^第\s*/, "").replace(/题$/, "").replace(/[．、-]/g, ".");
  if (!clean) return undefined;
  if (clean === String(questionNumber)) return `${questionNumber}.1`;
  return clean.startsWith(`${questionNumber}.`) ? clean : `${questionNumber}.${clean}`;
}

export class ExamService {
  private routerAgent = new RouterAgent();

  constructor(private retriever: FileBasedRetriever) {}

  public getExams(): ExamPaper[] {
    return Array.from(store.exams.values());
  }

  public getExamById(id: string): ExamPaper | undefined {
    return store.exams.get(id);
  }

  public async createExamFromText(params: {
    title: string;
    subject?: string;
    school_stage?: "PRIMARY" | "MIDDLE" | "HIGH";
    grade?: string;
    textbook_version?: string;
    publisher?: string;
    edition_year?: string;
    semester?: string;
    rawText: string;
    sourceFiles?: string[];
    expectedQuestionCount?: number;
    expectedTotalScore?: number;
  }): Promise<ExamPaper> {
    assertLikelyExamDocument(params.rawText, params.title);

    const examId = `exam_${Date.now()}`;
    const subject = params.subject || "chinese";
    const stage = params.school_stage || "MIDDLE";
    const usesUnifiedTextbook = ["chinese", "history", "politics"].includes(subject);

    // 1. Document Agent parsing
    // Agent instances keep prompt/tool-call state, so isolate them per import job.
    const docAgent = new DocumentAgent();
    const parserAgent = new QuestionParserAgent();
    const rubricAgent = new RubricAgent(this.retriever, stage);
    const docRes = await docAgent.parseDocument({
      filePath: "upload.txt",
      fileType: "text",
      rawText: params.rawText,
    });

    // 2. Question Parser Agent
    const parserRes = await parserAgent.parseQuestions(docRes.structuredMarkdown, params.title);

    if (parserRes.questions.length === 0) {
      throw new Error("未识别到有效题目，请确认上传的是试卷，并检查图片清晰度。");
    }

    if (
      params.expectedQuestionCount !== undefined &&
      parserRes.questions.length !== params.expectedQuestionCount
    ) {
      throw new Error(
        `完整性校验失败：预计 ${params.expectedQuestionCount} 道题，实际识别 ${parserRes.questions.length} 道题。请检查是否漏拍页面、页面顺序或图片清晰度。`
      );
    }
    if (
      params.expectedTotalScore !== undefined &&
      Math.abs(parserRes.totalScore - params.expectedTotalScore) > 0.01
    ) {
      throw new Error(
        `完整性校验失败：预计总分 ${params.expectedTotalScore} 分，实际识别 ${parserRes.totalScore} 分。请检查漏题或分值识别。`
      );
    }

    // 3. Rubric Agent & Router Agent for each question
    const questions: Question[] = [];
    let totalScore = 0;

    for (let i = 0; i < parserRes.questions.length; i++) {
      const q = parserRes.questions[i];
      const normalizedSubNum = normalizeSubNumber(q.num, q.sub_num);
      const safeSubNum = normalizedSubNum ? normalizedSubNum.replace(/[^a-zA-Z0-9]/g, "_") : `${i + 1}`;
      const qId = `q_${examId}_${q.num}_${safeSubNum}`;
      const routeMeta = this.routerAgent.route({
        stem: q.stem,
        type: q.type,
        score: q.score,
        subject: subject as any,
        school_stage: stage,
        grade: params.grade,
      });

      let standardAnswer: StandardAnswer | undefined;

      if (routeMeta.question_type === "single_choice" || routeMeta.question_type === "judge") {
        const inferredAnswer = routeMeta.question_type === "single_choice"
          ? inferSingleChoiceAnswer(q.stem, q.options || [])
          : "";
        standardAnswer = {
          id: `sa_${qId}`,
          question_id: qId,
          correct_answer: inferredAnswer,
          analysis: inferredAnswer
            ? `客观题标准答案为 ${inferredAnswer}，请教师核对或点击在线编辑修改选项。`
            : "客观题尚未推断出标准答案，请教师审核后再批改。",
          rubric_steps: [
            {
              step_no: 1,
              score: q.score,
              criteria: "准确选出正确选项",
              keywords: inferredAnswer ? [inferredAnswer] : [],
            },
          ],
          is_teacher_edited: false,
        };
      } else {
        // Run Rubric Agent for fill_blank, subjective_short, essay
        const rubricRes = await rubricAgent.generateRubric({
          questionTitle: q.sub_num ? `第 ${q.num} 题 (${q.sub_num})` : `第 ${q.num} 题 (${q.type})`,
          stem: q.stem,
          maxScore: q.score,
          referenceAnswer: "",
          school_stage: stage,
          grade: params.grade,
        });

        standardAnswer = {
          id: `sa_${qId}`,
          question_id: qId,
          correct_answer: rubricRes.standardAnswer || "参考答案已由 AI 综合生成，请教师审核确认。",
          analysis: rubricRes.analysis || "分步采分细则已由 Rubric Agent 自动生成，待教师审核。",
          rubric_steps: rubricRes.rubricSteps,
          is_teacher_edited: false,
        };
      }

      totalScore += q.score;
      questions.push({
        id: qId,
        exam_id: examId,
        question_num: q.num,
        sub_num: normalizedSubNum,
        q_type: (routeMeta.question_type.toUpperCase() as any) || "SUBJECTIVE_SHORT",
        stem_text: q.stem,
        options: q.options,
        score_value: q.score,
        standard_answer: standardAnswer,
      });
    }

    // 严格按大题序号与小问序号升序排序
    questions.sort((a, b) => {
      if (a.question_num !== b.question_num) {
        return a.question_num - b.question_num;
      }
      const subA = a.sub_num || "";
      const subB = b.sub_num || "";
      if (subA && subB) {
        const numA = parseFloat(subA.replace(/[^0-9.]/g, "")) || 0;
        const numB = parseFloat(subB.replace(/[^0-9.]/g, "")) || 0;
        if (numA !== numB) return numA - numB;
        return subA.localeCompare(subB, undefined, { numeric: true });
      }
      return subA ? 1 : subB ? -1 : 0;
    });

    const versionId = `${examId}_v1`;
    questions.forEach((question) => {
      question.version_id = `${question.id}_v1`;
      if (question.standard_answer) question.standard_answer.version_id = `${question.standard_answer.id}_v1`;
    });
    const exam: ExamPaper = {
      id: examId,
      version_id: versionId,
      title: params.title || parserRes.examTitle,
      subject,
      school_stage: stage,
      grade: params.grade || "初二",
      textbook_version: params.textbook_version || (usesUnifiedTextbook ? "国家统编教材" : "人教版"),
      publisher: params.publisher || "人民教育出版社",
      edition_year: params.edition_year || "",
      semester: params.semester || "八年级上册",
      total_score: totalScore,
      status: "PENDING_AUDIT",
      file_path: params.sourceFiles?.[0],
      source_files: params.sourceFiles || [],
      created_at: new Date().toISOString(),
      questions,
    };

    store.exams.set(examId, exam);
    store.persist();
    return exam;
  }

  public async createExamFromVision(params: {
    title: string;
    subject?: string;
    school_stage?: "PRIMARY" | "MIDDLE" | "HIGH";
    grade?: string;
    textbook_version?: string;
    publisher?: string;
    edition_year?: string;
    semester?: string;
    sourceFiles: string[];
    observations: ExamQuestionObservation[];
    visionPages: VisionPageEvidence[];
    reviewRequired: boolean;
  }): Promise<ExamPaper> {
    const examId = `exam_${Date.now()}`;
    const subject = params.subject || "chinese";
    const stage = params.school_stage || "MIDDLE";
    const questions: Question[] = params.observations.map((observation, index) => {
      const normalizedSubNum = normalizeSubNumber(observation.questionNumber, observation.subNumber);
      const safeSubNum = normalizedSubNum?.replace(/[^a-zA-Z0-9]/g, "_") || `${index + 1}`;
      const questionId = `q_${examId}_${observation.questionNumber}_${safeSubNum}`;
      const normalizedType = observation.type.toLowerCase();
      const qType = normalizedType.includes("multi") ? "MULTI_CHOICE" : normalizedType.includes("single") || normalizedType.includes("choice") ? "SINGLE_CHOICE" : normalizedType.includes("judge") ? "JUDGE" : normalizedType.includes("fill") ? "FILL_BLANK" : normalizedType.includes("essay") ? "ESSAY" : "SUBJECTIVE_SHORT";
      return {
        id: questionId,
        exam_id: examId,
        question_num: observation.questionNumber,
        sub_num: normalizedSubNum,
        q_type: qType,
        stem_text: observation.stem,
        options: observation.options,
        score_value: observation.score,
        standard_answer: {
          id: `sa_${questionId}`,
          question_id: questionId,
          correct_answer: observation.correctAnswer,
          analysis: observation.analysis,
          rubric_steps: observation.rubricSteps,
          is_teacher_edited: false,
        },
      };
    });
    const totalScore = questions.reduce((sum, question) => sum + question.score_value, 0);
    const exam: ExamPaper = {
      id: examId,
      version_id: `${examId}_v1`,
      title: params.title || "导入试卷",
      subject,
      school_stage: stage,
      grade: params.grade || "",
      textbook_version: params.textbook_version || "",
      publisher: params.publisher || "",
      edition_year: params.edition_year || "",
      semester: params.semester || "",
      total_score: totalScore,
      status: "PENDING_AUDIT",
      file_path: params.sourceFiles[0],
      source_files: params.sourceFiles,
      created_at: new Date().toISOString(),
      questions,
      vision_pages: params.visionPages,
      import_review_required: params.reviewRequired,
    };
    store.exams.set(examId, exam);
    store.persist();
    return exam;
  }

  public updateQuestionRubric(
    examId: string,
    questionId: string,
    rubricSteps: Array<{ step_no: number; score: number; criteria: string; keywords: string[] }>
  ): Question {
    const exam = store.exams.get(examId);
    if (!exam) throw new Error(`Exam ${examId} not found`);

    const q = exam.questions.find((item) => item.id === questionId);
    if (!q) throw new Error(`Question ${questionId} not found in exam ${examId}`);

    if (q.standard_answer) {
      q.standard_answer.rubric_steps = rubricSteps;
      q.standard_answer.is_teacher_edited = true;
      q.standard_answer.version_id = `${q.standard_answer.id}_v${Date.now()}`;
    }
    q.version_id = `${q.id}_v${Date.now()}`;
    exam.status = "PENDING_AUDIT";

    store.persist();
    return q;
  }

  public updateQuestionContent(
    examId: string,
    questionId: string,
    updates: {
      stemText?: string;
      options?: string[];
      correctAnswer?: string;
      analysis?: string;
    }
  ): Question {
    const exam = store.exams.get(examId);
    if (!exam) throw new Error(`Exam ${examId} not found`);

    const question = exam.questions.find((item) => item.id === questionId);
    if (!question) throw new Error(`Question ${questionId} not found in exam ${examId}`);

    if (updates.stemText !== undefined) {
      const stemText = updates.stemText.trim();
      if (!stemText) throw new Error("题干内容不能为空");
      question.stem_text = stemText;
    }
    if (updates.options !== undefined) {
      question.options = updates.options.map((item) => item.trim()).filter(Boolean);
    }
    if (question.standard_answer) {
      if (updates.correctAnswer !== undefined) {
        question.standard_answer.correct_answer = updates.correctAnswer.trim();
      }
      if (updates.analysis !== undefined) {
        question.standard_answer.analysis = updates.analysis.trim();
      }
      question.standard_answer.is_teacher_edited = true;
      question.standard_answer.version_id = `${question.standard_answer.id}_v${Date.now()}`;
    }
    question.version_id = `${question.id}_v${Date.now()}`;
    exam.status = "PENDING_AUDIT";

    store.persist();
    return question;
  }

  public auditAndLockExam(examId: string): ExamPaper {
    const exam = store.exams.get(examId);
    if (!exam) throw new Error(`Exam ${examId} not found`);

    exam.status = "AUDITED";
    store.persist();
    return exam;
  }

  public deleteExam(examId: string): void {
    store.deleteExam(examId);
  }
}
