import express, { Request, Response } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import multer from "multer";

// 自动按优先级加载 app/.env 及当前目录 .env
const envPaths = [
  path.resolve(process.cwd(), "..", ".env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", "..", ".env"),
];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
  }
}

import { FileBasedRetriever } from "@teachmate/agent-engine";
import { store } from "./db/store.js";
import { ExamService } from "./services/exam.service.js";
import { GradingService, type GradingSSEEvent } from "./services/grading.service.js";
import { RevisionService } from "./services/revision.service.js";
import { AnalyticsService } from "./services/analytics.service.js";
import { VisionService, type UploadedVisionFile } from "./services/vision.service.js";

const app: express.Express = express();
const PORT = process.env.PORT || 8004;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Paths are overridable by the desktop host. Development keeps the original
// monorepo defaults, while packaged builds use the OS user-data directory.
const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(process.cwd(), "..", "file-server", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    // Preserve readable original filename with timestamp suffix
    const original = Buffer.from(file.originalname, "latin1").toString("utf8");
    const uniqueSuffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const ext = path.extname(original);
    const base = path.basename(original, ext).replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 80) || "upload";
    const safeName = `${base}_${uniqueSuffix}${ext}`;
    cb(null, safeName);
  },
});
const allowedUploadTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const upload = multer({
  storage,
  // DeepSeek inline vision accepts one image up to 32 MiB. Larger files
  // require Files API, which is not part of the Pi ImageContent path.
  limits: { fileSize: 32 * 1024 * 1024, files: 100 },
  fileFilter: (_req, file, cb) => {
    if (allowedUploadTypes.has(file.mimetype)) return cb(null, true);
    cb(new Error("仅支持 JPG、PNG、GIF 或 WebP 图片"));
  },
});


// Initialize Services
const kbDir = process.env.KB_DIR
  ? path.resolve(process.env.KB_DIR)
  : path.resolve(process.cwd(), "..", "..", "knowledge-base");
const retriever = new FileBasedRetriever(kbDir);
const examService = new ExamService(retriever);
const gradingService = new GradingService(retriever);
const revisionService = new RevisionService(retriever);
const analyticsService = new AnalyticsService();
const visionService = new VisionService(examService, gradingService, uploadsDir);

// SSE client management
const sseClients = new Map<string, Response[]>();

gradingService.on("grading_event", (event: GradingSSEEvent) => {
  const clients = sseClients.get(event.submissionId) || [];
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  clients.forEach((res) => res.write(payload));

  // Global broadcast for batch monitoring
  const globalClients = sseClients.get("all") || [];
  globalClients.forEach((res) => res.write(payload));
});

// --- API Endpoints ---

// 1. Health
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 2. Exam Management
app.get("/api/exams", (_req, res) => {
  res.json(examService.getExams());
});

app.get("/api/exams/:id", (req, res) => {
  const exam = examService.getExamById(req.params.id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  res.json(exam);
});

app.post("/api/exams", async (req, res) => {
  try {
    const exam = await examService.createExamFromText(req.body);
    res.status(201).json(exam);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.put("/api/exams/:examId/questions/:qId/rubric", (req, res) => {
  try {
    const updated = examService.updateQuestionRubric(
      req.params.examId,
      req.params.qId,
      req.body.rubricSteps
    );
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/exams/:examId/questions/:qId", (req, res) => {
  try {
    const updated = examService.updateQuestionContent(
      req.params.examId,
      req.params.qId,
      req.body
    );
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/exams/:id/audit", (req, res) => {
  try {
    const audited = examService.auditAndLockExam(req.params.id);
    res.json(audited);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/exams/:id", (req, res) => {
  try {
    examService.deleteExam(req.params.id);
    res.json({ success: true, message: `Exam ${req.params.id} deleted` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Submissions & Batch Grading
app.get("/api/submissions", (req, res) => {
  const examId = req.query.examId as string | undefined;
  res.json(gradingService.getSubmissions(examId));
});

app.get("/api/submissions/:id", (req, res) => {
  const sub = gradingService.getSubmissionById(req.params.id);
  if (!sub) return res.status(404).json({ error: "Submission not found" });
  res.json(sub);
});

app.post("/api/submissions/:id/retry", async (req, res) => {
  try {
    await visionService.retrySubmission(req.params.id);
    res.status(202).json({ success: true, submissionId: req.params.id, status: "GRADING" });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/submissions/:submissionId/grading-details/:detailId/review", (req, res) => {
  try {
    const detail = gradingService.reviewGradingDetail({
      submissionId: req.params.submissionId,
      detailId: req.params.detailId,
      finalScore: Number(req.body.finalScore),
      reason: typeof req.body.reason === "string" ? req.body.reason : undefined,
    });
    res.json(detail);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/grading/start", async (req, res) => {
  try {
    const { examId, studentAnswersList } = req.body;
    const submissionIds = await gradingService.startBatchGrading(examId, studentAnswersList);
    res.json({ submissionIds, count: submissionIds.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 批量视觉预览：不会立即建答卷或启动批改，教师确认身份和证据后再提交。
app.post("/api/submissions/preview-files", upload.array("files", 100), async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    const examId = String(req.body.examId || "");
    if (!examId) throw new Error("examId 不能为空");
    if (!files.length) throw new Error("请至少上传一份学生答卷");

    const result = await visionService.previewStudentAnswerFiles({
      examId,
      defaultClassName: String(req.body.defaultClassName || "").trim(),
      files: files.map((file) => ({ filename: file.filename, originalName: Buffer.from(file.originalname, "latin1").toString("utf8"), mimeType: file.mimetype })),
    });
    res.status(201).json(result);
  } catch (err: any) {
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    await Promise.all(files.map((file) => fs.promises.unlink(file.path).catch(() => undefined)));
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/submissions/confirm-batch", async (req, res) => {
  try {
    const result = await visionService.confirmStudentAnswerBatch({
      batchId: String(req.body.batchId || ""),
      examId: String(req.body.examId || ""),
      items: req.body.items,
    });
    res.status(201).json({ ...result, count: result.submissionIds.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/submissions/import-batches/:batchId", async (req, res) => {
  await visionService.discardStudentAnswerBatch(req.params.batchId);
  res.status(204).end();
});

// 4. SSE Progress Stream
app.get("/api/grading/sse/:submissionId", (req: Request, res: Response) => {
  const subId = String(req.params.submissionId);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (!sseClients.has(subId)) {
    sseClients.set(subId, []);
  }
  sseClients.get(subId)!.push(res);

  res.write(`data: ${JSON.stringify({ stage: "CONNECTED", message: "SSE connected" })}\n\n`);
  for (const event of store.getGradingEvents(subId)) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  req.on("close", () => {
    const clients = sseClients.get(subId) || [];
    sseClients.set(
      subId,
      clients.filter((client) => client !== res)
    );
  });
});

// 5. Revision
app.post("/api/revision", async (req, res) => {
  try {
    const result = await revisionService.submitRevision(req.body);
    res.json(result);
  } catch (err: any) {
    // Invalid revision targets/answers are client errors; model failures remain
    // server errors so the client can distinguish retryable failures.
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// 6. Trace Audit Logs
app.get("/api/traces", (req, res) => {
  const subId = req.query.submissionId as string | undefined;
  res.json(gradingService.getExecutionLogs(subId));
});

app.get("/api/review-tasks", (req, res) => {
  res.json(gradingService.getReviewTasks(typeof req.query.status === "string" ? req.query.status : "OPEN"));
});

app.get("/api/workflows/:id", (req, res) => {
  const run = store.getWorkflowRun(req.params.id);
  if (!run) return res.status(404).json({ error: "Workflow not found" });
  res.json({ run, steps: store.listWorkflowSteps(req.params.id) });
});

// 7. Analytics
app.get("/api/analytics/:examId", (req, res) => {
  const className = req.query.className as string | undefined;
  // Analytics is backed by mutable grading results. Do not let the browser or
  // a development proxy keep showing the previous distribution after grading.
  res.set("Cache-Control", "no-store");
  res.json(analyticsService.getClassAnalytics(req.params.examId, className));
});

// 8. Original image upload and Pi Vision import endpoints
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "未上传文件" });
  const filename = req.file.filename;
  const fileServerBase = process.env.FILE_SERVER_URL ?? "http://localhost:8002";
  res.json({ filename, originalName: req.file.originalname, size: req.file.size, url: `${fileServerBase}/files/${encodeURIComponent(filename)}` });
});

app.post("/api/exams/import", upload.array("files", 50), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) || [];
  try {
    if (!files.length) return res.status(400).json({ error: "请至少上传一张试卷图片" });
    const optionalNumber = (value: unknown): number | undefined => {
      if (value === undefined || value === null || value === "") return undefined;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("预期题数和总分必须为正数");
      return parsed;
    };
    const result = await visionService.parseAndCreateExamFromFiles({
      files: files.map((file) => ({ filename: file.filename, originalName: Buffer.from(file.originalname, "latin1").toString("utf8"), mimeType: file.mimetype })),
      title: req.body.title,
      subject: req.body.subject,
      school_stage: req.body.school_stage,
      grade: req.body.grade,
      textbook_version: req.body.textbook_version,
      publisher: req.body.publisher,
      edition_year: req.body.edition_year,
      semester: req.body.semester,
      expectedQuestionCount: optionalNumber(req.body.expected_question_count),
      expectedTotalScore: optionalNumber(req.body.expected_total_score),
    });
    res.status(201).json(result);
  } catch (err: any) {
    await Promise.all(files.map((file) => fs.promises.unlink(file.path).catch(() => undefined)));
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// Log Management & Diagnostic Endpoints
// ==========================================
app.get("/api/logs", (_req, res) => {
  res.json({
    count: store.executionLogs.length,
    logs: store.executionLogs,
  });
});

app.get("/api/logs/llm/files", (_req, res) => {
  const logsDir = process.env.LOGS_DIR
    ? path.resolve(process.env.LOGS_DIR)
    : path.resolve(process.cwd(), "..", "logs");
  if (!fs.existsSync(logsDir)) {
    return res.json({ files: [] });
  }
  const files = fs
    .readdirSync(logsDir)
    .filter((f) => f.endsWith(".log"))
    .map((f) => ({
      name: f,
      size: fs.statSync(path.join(logsDir, f)).size,
      updatedAt: fs.statSync(path.join(logsDir, f)).mtime,
    }))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  res.json({ files });
});

app.get("/api/logs/llm", (req, res) => {
  const logsDir = process.env.LOGS_DIR
    ? path.resolve(process.env.LOGS_DIR)
    : path.resolve(process.cwd(), "..", "logs");
  const fileName = req.query.file ? String(req.query.file) : "llm_interactions_latest.log";

  let targetPath = path.join(logsDir, fileName);
  if (!fs.existsSync(targetPath)) {
    targetPath = path.join(logsDir, "llm_interactions.log");
  }

  if (!fs.existsSync(targetPath)) {
    return res.type("text/plain").send("暂无 LLM 交互日志记录（发起切题或批改后将自动生成）。");
  }

  const logContent = fs.readFileSync(targetPath, "utf8");
  res.type("text/plain; charset=utf-8").send(logContent);
});

// The desktop build serves uploaded evidence and the compiled React app from
// the same loopback origin. The standalone file-server remains available for
// development and external deployments.
app.use("/files", express.static(uploadsDir, { fallthrough: false }));
const webDistDir = process.env.WEB_DIST_DIR ? path.resolve(process.env.WEB_DIST_DIR) : "";
if (webDistDir && fs.existsSync(webDistDir)) {
  app.use(express.static(webDistDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/files/")) return next();
    res.sendFile(path.join(webDistDir, "index.html"));
  });
}

app.use((err: any, _req: Request, res: Response, _next: unknown) => {
  const status = err instanceof multer.MulterError ? 400 : 415;
  res.status(status).json({ error: err.message || "文件上传失败" });
});

export function startServer(port: number | string = PORT) {
  const server = app.listen(Number(port), "127.0.0.1", () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    console.log(`[TeachMate Server] Running on http://127.0.0.1:${actualPort}`);
  });
  return server;
}

// Normal CLI execution (pnpm --filter @teachmate/server start).
if (process.env.TEACHMATE_EMBEDDED !== "1") {
  startServer();
}

export { app };
