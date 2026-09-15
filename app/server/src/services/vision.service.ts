import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RuntimeImage, VisionAnswer, IdentityEvidence } from "@teachmate/agent-engine";
import { VisionAnswerAgent as VisionAgent } from "@teachmate/agent-engine";
import type { ExamPaper } from "../db/store.js";
import { store } from "../db/store.js";
import type { ExamService } from "./exam.service.js";
import type { GradingService, MultimodalSubmissionInput } from "./grading.service.js";
import { createStudentIdentityKey, findDuplicateSubmission, findDuplicateSubmissions, sha256 } from "./import-utils.js";

export interface UploadedVisionFile {
  filename: string;
  originalName: string;
  mimeType: string;
}

export interface StudentVisionPreviewItem {
  id: string;
  originalName: string;
  studentName: string;
  className: string;
  studentNumber: string;
  identityConfidence: number;
  answerCount: number;
  totalQuestionCount: number;
  reviewRequired: boolean;
  reviewReason: string;
  duplicate?: { type: "EXACT_FILE" | "SAME_STUDENT"; submissionId: string; studentName: string };
  warnings: string[];
}

interface InternalPreviewItem extends StudentVisionPreviewItem {
  filename: string;
  mimeType: string;
  sourceHash: string;
  identity: IdentityEvidence;
  visionAnswers: VisionAnswer[];
}

interface VisionImportBatch {
  id: string;
  examId: string;
  createdAt: number;
  items: InternalPreviewItem[];
}

export class VisionService {
  private readonly agent = new VisionAgent();
  private readonly batches = new Map<string, VisionImportBatch>();
  private readonly ttlMs = 30 * 60 * 1000;

  constructor(
    private readonly examService: ExamService,
    private readonly gradingService: GradingService,
    private readonly uploadsDir: string,
  ) {}

  public async parseAndCreateExamFromFiles(params: {
    files: UploadedVisionFile[];
    title?: string;
    subject?: string;
    school_stage?: "PRIMARY" | "MIDDLE" | "HIGH";
    grade?: string;
    textbook_version?: string;
    publisher?: string;
    edition_year?: string;
    semester?: string;
    expectedQuestionCount?: number;
    /** 试卷总分：作为自动配分的目标总分，未填写时默认 100。 */
    totalScore?: number;
    /** 兼容旧字段：等价于 totalScore。 */
    expectedTotalScore?: number;
  }): Promise<{ exam: ExamPaper; pageCount: number; fileUrls: string[]; reviewRequired: boolean }> {
    if (!params.files.length) throw new Error("请至少上传一张试卷图片");
    const images = await this.loadImages(params.files);
    const analysis = await this.agent.analyzeExam({ images, title: params.title });
    if (!analysis.questions.length) throw new Error(`未识别到题目：${analysis.reviewReason || "请补充清晰的试卷图片"}`);
    if (params.expectedQuestionCount !== undefined && analysis.questions.length !== params.expectedQuestionCount) {
      throw new Error(`题目数量校验失败：期望 ${params.expectedQuestionCount}，识别到 ${analysis.questions.length}，请先复核`);
    }
    // 总分不再作为硬校验：未标注分值的试卷由程序配分引擎按题型权重补齐并强制对齐总分。
    const requestedTotalScore = Number(params.totalScore) > 0
      ? Number(params.totalScore)
      : Number(params.expectedTotalScore) > 0
        ? Number(params.expectedTotalScore)
        : undefined;
    const exam = await this.examService.createExamFromVision({
      title: analysis.title,
      subject: params.subject,
      school_stage: params.school_stage,
      grade: params.grade,
      textbook_version: params.textbook_version,
      publisher: params.publisher,
      edition_year: params.edition_year,
      semester: params.semester,
      sourceFiles: params.files.map((file) => file.filename),
      observations: analysis.questions,
      visionPages: analysis.pages,
      reviewRequired: analysis.reviewRequired,
      totalScore: requestedTotalScore,
    });
    return {
      exam,
      pageCount: images.length,
      reviewRequired: analysis.reviewRequired,
      fileUrls: params.files.map((file) => this.fileUrl(file.filename)),
    };
  }

  public async previewStudentAnswerFiles(params: {
    examId: string;
    files: UploadedVisionFile[];
    defaultClassName?: string;
  }): Promise<{ batchId: string; expiresAt: string; count: number; items: StudentVisionPreviewItem[] }> {
    const exam = store.exams.get(params.examId);
    if (!exam) throw new Error(`试卷不存在: ${params.examId}`);
    if (!params.files.length) throw new Error("请至少上传一份学生答卷图片");
    this.pruneExpired();
    const items: InternalPreviewItem[] = [];
    for (const [index, file] of params.files.entries()) {
      const sourceHash = sha256(fs.readFileSync(path.join(this.uploadsDir, file.filename)));
      const images = await this.loadImages([file]);
      const traceStartedAt = Date.now();
      let analysis;
      try {
        analysis = await this.agent.analyzeStudentAnswers({ images, questions: exam.questions });
        this.recordVisionTrace(params.examId, traceStartedAt, "SUCCESS", {
          operation: "student_answer_preview",
          imageCount: images.length,
          answerCount: analysis.answers.length,
          reviewRequired: analysis.reviewRequired,
        });
      } catch (error) {
        this.recordVisionTrace(params.examId, traceStartedAt, "FAILED", {
          operation: "student_answer_preview",
          imageCount: images.length,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      const identity = {
        ...analysis.identity,
        className: analysis.identity.className || params.defaultClassName || "",
      };
      const identityKey = createStudentIdentityKey(identity);
      const duplicate = findDuplicateSubmission({ submissions: store.submissions.values(), examId: params.examId, sourceHash, identityKey });
      const warnings = [...(analysis.reviewRequired ? [analysis.reviewReason || "视觉证据需要教师核验"] : [])];
      if (!identity.studentName) warnings.push("未确认学生姓名");
      if (!identity.className) warnings.push("未确认班级");
      if (analysis.answers.some((answer) => answer.reviewRequired)) warnings.push("部分题目答案证据不足或存在跨题风险");
      items.push({
        id: `preview_${index}_${randomUUID()}`,
        originalName: file.originalName,
        filename: file.filename,
        mimeType: file.mimeType,
        sourceHash,
        identity,
        visionAnswers: analysis.answers,
        studentName: identity.studentName,
        className: identity.className,
        studentNumber: identity.studentNumber,
        identityConfidence: identity.confidence,
        answerCount: analysis.answers.filter((answer) => answer.studentAnswer || answer.answerEvidence).length,
        totalQuestionCount: exam.questions.length,
        reviewRequired: analysis.reviewRequired,
        reviewReason: analysis.reviewReason,
        duplicate: duplicate ? { type: duplicate.type, submissionId: duplicate.submission.id, studentName: duplicate.submission.student_name } : undefined,
        warnings,
      });
    }
    const batch: VisionImportBatch = { id: `vision_import_${randomUUID()}`, examId: params.examId, createdAt: Date.now(), items };
    this.batches.set(batch.id, batch);
    return {
      batchId: batch.id,
      expiresAt: new Date(batch.createdAt + this.ttlMs).toISOString(),
      count: items.length,
      items: items.map(({ filename: _filename, mimeType: _mimeType, sourceHash: _sourceHash, identity: _identity, visionAnswers: _answers, ...item }) => item),
    };
  }

  public async confirmStudentAnswerBatch(params: {
    batchId: string;
    examId: string;
    items: Array<{ id: string; studentName: string; className: string; studentNumber?: string; duplicateAction?: "SKIP" | "REPLACE" }>;
  }): Promise<{ submissionIds: string[]; skipped: Array<{ id: string; reason: string }> }> {
    this.pruneExpired();
    const batch = this.batches.get(params.batchId);
    if (!batch || batch.examId !== params.examId) throw new Error("答卷预览已失效，请重新上传");
    const corrections = new Map(params.items.map((item) => [item.id, item]));
    const skipped: Array<{ id: string; reason: string }> = [];
    const inputs: MultimodalSubmissionInput[] = [];
    for (const item of batch.items) {
      const correction = corrections.get(item.id);
      if (!correction) continue;
      // A low-confidence vision result is reviewable evidence, not a reason
      // to discard the submission. Create it and let the grading pipeline mark
      // the submission REVIEW_PENDING with the corresponding review task.
      const studentName = correction.studentName.trim();
      const className = correction.className.trim();
      if (!studentName || !className) throw new Error(`文件【${item.originalName}】缺少学生姓名或班级`);
      const identityKey = createStudentIdentityKey({ studentName, className, studentNumber: correction.studentNumber });
      const duplicate = findDuplicateSubmission({ submissions: store.submissions.values(), examId: params.examId, sourceHash: item.sourceHash, identityKey });
      if (duplicate && correction.duplicateAction !== "REPLACE") {
        skipped.push({ id: item.id, reason: "该学生答卷已存在" });
        continue;
      }
      if (duplicate) {
        // A replacement must remove every stale record for this identity. Older
        // imports may have bypassed the unique index or left an in-memory copy.
        for (const match of findDuplicateSubmissions({
          submissions: store.submissions.values(),
          examId: params.examId,
          sourceHash: item.sourceHash,
          identityKey,
        })) {
          store.deleteSubmission(match.submission.id);
        }
      }
      inputs.push({
        studentName,
        className,
        studentNumber: correction.studentNumber || "",
        identityKey,
        sourceHash: item.sourceHash,
        sourceFileName: item.originalName,
        sourceFiles: [item.filename],
        visionAnswers: item.visionAnswers,
        identityEvidence: item.identity,
      });
    }
    const submissionIds = inputs.length ? await this.gradingService.startBatchGrading(params.examId, inputs) : [];
    const kept = new Set(inputs.flatMap((input) => input.sourceFiles || []));
    await Promise.all(batch.items.filter((item) => !kept.has(item.filename)).map((item) => fs.promises.unlink(path.join(this.uploadsDir, item.filename)).catch(() => undefined)));
    this.batches.delete(batch.id);
    return { submissionIds, skipped };
  }

  public async discardStudentAnswerBatch(batchId: string): Promise<void> {
    const batch = this.batches.get(batchId);
    if (!batch) return;
    this.batches.delete(batchId);
    await Promise.all(batch.items.map((item) => fs.promises.unlink(path.join(this.uploadsDir, item.filename)).catch(() => undefined)));
  }

  public async retrySubmission(submissionId: string): Promise<void> {
    const submission = this.gradingService.getSubmissionById(submissionId);
    if (!submission) throw new Error(`答卷不存在: ${submissionId}`);
    const exam = store.exams.get(submission.exam_id);
    if (!exam) throw new Error(`试卷不存在: ${submission.exam_id}`);
    const sourceFiles = submission.source_files || [];
    if (!sourceFiles.length) throw new Error("该答卷没有保留原始图片，无法重试");
    const images = await this.loadImages(sourceFiles.map((filename) => ({ filename, originalName: filename, mimeType: this.mimeType(filename) })));
    const analysis = await this.agent.analyzeStudentAnswers({ images, questions: exam.questions });
    this.gradingService.retrySubmission(submissionId, analysis.answers);
  }

  private recordVisionTrace(
    examId: string,
    startedAt: number,
    status: "SUCCESS" | "FAILED",
    output: Record<string, unknown>,
  ): void {
    store.executionLogs.unshift({
      id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      submission_id: "",
      question_id: "",
      agent_name: "VisionAnswerAgent",
      model: process.env.PI_MODEL_ID || "deepseek-flash",
      input_context: JSON.stringify({ operation: "student_answer_preview", examId }),
      output_content: JSON.stringify(output),
      prompt_tokens: 0,
      completion_tokens: 0,
      latency_ms: Date.now() - startedAt,
      status,
      created_at: new Date().toISOString(),
    });
    store.persist();
  }

  private async loadImages(files: Array<UploadedVisionFile | string>): Promise<RuntimeImage[]> {
    const maxImages = Math.max(1, Number(process.env.PI_MODEL_MAX_IMAGES_PER_RUN) || 8);
    if (files.length > maxImages) throw new Error(`一次最多上传 ${maxImages} 张图片`);
    return files.map((file) => {
      const filename = typeof file === "string" ? file : file.filename;
      const mimeType = typeof file === "string" ? this.mimeType(filename) : file.mimeType;
      if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mimeType)) throw new Error("当前多模态链路只接受 JPG、PNG、GIF、WebP 图片");
      return { mediaType: mimeType as RuntimeImage["mediaType"], data: fs.readFileSync(path.join(this.uploadsDir, filename)).toString("base64"), filename };
    });
  }

  private mimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    return ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/jpeg";
  }

  private fileUrl(filename: string): string {
    const fileServerBase = process.env.FILE_SERVER_URL ?? "http://localhost:8002";
    return `${fileServerBase}/files/${encodeURIComponent(filename)}`;
  }

  private pruneExpired(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, batch] of this.batches) if (batch.createdAt < cutoff) this.batches.delete(id);
  }
}
