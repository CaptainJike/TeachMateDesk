import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface VisionPageEvidence {
  page: number;
  rotation: 0 | 90 | 180 | 270;
  layout: "single_column" | "multi_column" | "mixed" | "unknown";
  confidence: number;
}

export interface IdentityEvidence {
  studentName: string;
  className: string;
  studentNumber: string;
  confidence: number;
  evidence: string;
}

export interface VisionAnswerEvidence {
  questionId: string;
  questionNumber: string;
  studentAnswer: string;
  answerEvidence: string;
  answerRegion: { page: number; description: string };
  confidence: number;
  isCrossQuestionRisk: boolean;
  reviewRequired: boolean;
  reviewReason: string;
}

export interface ExamPaper {
  id: string;
  version_id?: string;
  title: string;
  subject: string;
  school_stage: "PRIMARY" | "MIDDLE" | "HIGH";
  grade: string;
  textbook_version: string;
  publisher?: string;
  edition_year?: string;
  semester: string;
  total_score: number;
  status: "DRAFT" | "VISION_ANALYSIS" | "RUBRIC_GENERATING" | "PENDING_AUDIT" | "AUDITED";
  file_path?: string;
  source_files?: string[];
  created_at: string;
  questions: Question[];
  vision_pages?: VisionPageEvidence[];
  import_review_required?: boolean;
}

export interface Question {
  id: string;
  version_id?: string;
  exam_id: string;
  question_num: number;
  sub_num?: string;
  q_type: "SINGLE_CHOICE" | "MULTI_CHOICE" | "JUDGE" | "FILL_BLANK" | "SUBJECTIVE_SHORT" | "ESSAY";
  stem_text: string;
  options?: string[];
  score_value: number;
  standard_answer?: StandardAnswer;
}

export interface StandardAnswer {
  id: string;
  version_id?: string;
  question_id: string;
  correct_answer: string;
  analysis: string;
  rubric_steps: Array<{
    step_no: number;
    score: number;
    criteria: string;
    keywords: string[];
  }>;
  is_teacher_edited: boolean;
}

export interface StudentSubmission {
  id: string;
  exam_id: string;
  exam_version_id?: string;
  student_id: string;
  student_number?: string;
  student_name: string;
  class_name?: string;
  identity_key?: string;
  source_hash?: string;
  source_file_name?: string;
  import_batch_id?: string;
  status: "SUBMITTED" | "QUEUED" | "GRADING" | "RETRYING" | "REVIEW_PENDING" | "COMPLETED" | "FAILED";
  total_score: number;
  ai_score: number;
  source_files?: string[];
  identity_evidence?: IdentityEvidence;
  vision_answers?: VisionAnswerEvidence[];
  submitted_at: string;
  grading_details: GradingDetail[];
}

export interface GradingDetail {
  id: string;
  submission_id: string;
  question_id: string;
  question_num: number;
  sub_num?: string;
  question_type: string;
  stem_text: string;
  student_answer: string;
  final_score: number;
  ai_score: number;
  max_score: number;
  score_status: "FULL_CORRECT" | "PARTIAL_CORRECT" | "WRONG";
  step_details: Array<{
    step_no: number;
    score: number;
    max_score: number;
    is_hit: boolean;
    evidence: string;
    reason?: string;
  }>;
  error_type?: "KNOWLEDGE_GAP" | "LOGIC_STEP_MISSING" | "CALC_ERROR" | "EXPRESSION_BIAS" | "NONE";
  ai_feedback?: string;
  confidence: number;
  is_reviewed: boolean;
  review_required?: boolean;
  review_reason?: string;
  revision_logs?: RevisionLog[];
  student_evidence?: string[];
  answer_region?: { page: number; description: string; x?: number; y?: number; width?: number; height?: number };
  vision_confidence?: number;
  grading_route?: string;
  agent_model?: string;
}

export interface WorkflowRun {
  id: string;
  workflow_type: "GRADING" | "REVISION" | "EXAM_IMPORT";
  resource_id?: string;
  status: "CREATED" | "QUEUED" | "RUNNING" | "RETRYING" | "REVIEW_PENDING" | "COMPLETED" | "FAILED";
  attempt: number;
  idempotency_key?: string;
  error_message?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

export interface WorkflowStep {
  id: string;
  run_id: string;
  step_key: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  attempt: number;
  input_json?: string;
  output_json?: string;
  error_message?: string;
  started_at?: string;
  completed_at?: string;
}

export interface AgentExecutionLog {
  id: string;
  submission_id: string;
  question_id: string;
  agent_name: string;
  model: string;
  input_context: string;
  output_content: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  status: "SUCCESS" | "FAILED" | "BLOCKED";
  created_at: string;
}

export interface RevisionLog {
  id: string;
  grading_detail_id: string;
  revision_round: number;
  revised_answer: string;
  new_score: number;
  feedback: string;
  revised_at: string;
}

/**
 * 原生 SQLite 数据库存储驱动 (使用 Node 22+ 内置 SQLite 引擎)
 * 自动持久化至 .env 指定的 SQLITE_DB_PATH (如 data/teachmate.sqlite 或 data/teachmate.db)
 */
export class SqliteStore {
  private db: DatabaseSync;
  public dbPath: string;

  public exams: Map<string, ExamPaper> = new Map();
  public submissions: Map<string, StudentSubmission> = new Map();
  public executionLogs: AgentExecutionLog[] = [];
  public workflowRuns: Map<string, WorkflowRun> = new Map();
  public workflowSteps: Map<string, WorkflowStep> = new Map();

  constructor() {
    const rawPath =
      process.env.SQLITE_DB_PATH || process.env.DATABASE_PATH || "data/teachmate.sqlite";

    this.dbPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), "..", rawPath);

    // 确保数据目录存在
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath);
    this.createTables();
    this.loadFromDb();

    console.log(
      `\x1b[35m[SQLite Database]\x1b[0m 🗄️ 已挂载 SQLite 数据库: \x1b[1m${this.dbPath}\x1b[0m (试卷: ${this.exams.size} 套, 答卷: ${this.submissions.size} 份)`
    );
  }

  private createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS exams (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subject TEXT NOT NULL,
        school_stage TEXT NOT NULL,
        grade TEXT NOT NULL,
        textbook_version TEXT,
        publisher TEXT,
        edition_year TEXT,
        semester TEXT,
        total_score REAL DEFAULT 0,
        status TEXT NOT NULL,
        file_path TEXT,
        source_files_json TEXT,
        vision_pages_json TEXT,
        import_review_required INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        questions_json TEXT
      );

      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        exam_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        student_number TEXT DEFAULT '',
        student_name TEXT NOT NULL,
        class_name TEXT DEFAULT '',
        identity_key TEXT DEFAULT '',
        source_hash TEXT DEFAULT '',
        source_file_name TEXT DEFAULT '',
        import_batch_id TEXT DEFAULT '',
        status TEXT NOT NULL,
        total_score REAL DEFAULT 0,
        ai_score REAL DEFAULT 0,
        source_files_json TEXT,
        identity_evidence_json TEXT,
        vision_answers_json TEXT,
        submitted_at TEXT NOT NULL,
        grading_details_json TEXT
      );

      CREATE TABLE IF NOT EXISTS agent_execution_logs (
        id TEXT PRIMARY KEY,
        submission_id TEXT,
        question_id TEXT,
        agent_name TEXT NOT NULL,
        model TEXT NOT NULL,
        input_context TEXT,
        output_content TEXT,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        latency_ms INTEGER DEFAULT 0,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_type TEXT NOT NULL,
        resource_id TEXT,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        idempotency_key TEXT UNIQUE,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS workflow_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        step_key TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        input_json TEXT,
        output_json TEXT,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT,
        UNIQUE(run_id, step_key)
      );

      CREATE TABLE IF NOT EXISTS review_tasks (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL,
        question_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS grading_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id TEXT NOT NULL,
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    // 自动数据库轻量迁移支持 (若老版本 SQLite 已存在无 class_name 字段的表结构)
    try {
      this.db.exec(`ALTER TABLE submissions ADD COLUMN class_name TEXT DEFAULT ''`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE exams ADD COLUMN publisher TEXT`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE exams ADD COLUMN edition_year TEXT`);
    } catch {}
    try {
      this.db.exec(`ALTER TABLE exams ADD COLUMN source_files_json TEXT`);
    } catch {}
    for (const column of ["vision_pages_json", "import_review_required"]) {
      try { this.db.exec(`ALTER TABLE exams ADD COLUMN ${column} ${column === "import_review_required" ? "INTEGER DEFAULT 0" : "TEXT"}`); } catch {}
    }
    for (const column of ["student_number", "identity_key", "source_hash", "source_file_name", "import_batch_id"]) {
      try {
        this.db.exec(`ALTER TABLE submissions ADD COLUMN ${column} TEXT DEFAULT ''`);
      } catch {}
    }
    try {
      this.db.exec(`ALTER TABLE submissions ADD COLUMN source_files_json TEXT`);
    } catch {}
    for (const column of ["identity_evidence_json", "vision_answers_json"]) {
      try { this.db.exec(`ALTER TABLE submissions ADD COLUMN ${column} TEXT`); } catch {}
    }
    // Rebuild legacy submissions tables that still contain the obsolete image-path field.
    // SQLite DROP COLUMN is unavailable on some Node runtimes, so copy the data into the current shape.
    const submissionColumns = this.db.prepare(`PRAGMA table_info(submissions)`).all() as Array<{ name: string }>;
    if (submissionColumns.some((column) => column.name === "raw_image_path")) {
      this.db.exec(`
        CREATE TABLE submissions_v2 (
          id TEXT PRIMARY KEY,
          exam_id TEXT NOT NULL,
          student_id TEXT NOT NULL,
          student_number TEXT DEFAULT '',
          student_name TEXT NOT NULL,
          class_name TEXT DEFAULT '',
          identity_key TEXT DEFAULT '',
          source_hash TEXT DEFAULT '',
          source_file_name TEXT DEFAULT '',
          import_batch_id TEXT DEFAULT '',
          status TEXT NOT NULL,
          total_score REAL DEFAULT 0,
          ai_score REAL DEFAULT 0,
          source_files_json TEXT,
          identity_evidence_json TEXT,
          vision_answers_json TEXT,
          submitted_at TEXT NOT NULL,
          grading_details_json TEXT
        );
        INSERT INTO submissions_v2 (id, exam_id, student_id, student_number, student_name, class_name, identity_key, source_hash, source_file_name, import_batch_id, status, total_score, ai_score, source_files_json, identity_evidence_json, vision_answers_json, submitted_at, grading_details_json)
        SELECT id, exam_id, student_id, COALESCE(student_number, ''), student_name, COALESCE(class_name, ''), COALESCE(identity_key, ''), COALESCE(source_hash, ''), COALESCE(source_file_name, ''), COALESCE(import_batch_id, ''), status, total_score, ai_score, COALESCE(source_files_json, '[]'), COALESCE(identity_evidence_json, 'null'), COALESCE(vision_answers_json, '[]'), submitted_at, grading_details_json
        FROM submissions;
        DROP TABLE submissions;
        ALTER TABLE submissions_v2 RENAME TO submissions;
      `);
    }
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_submissions_exam_identity
      ON submissions(exam_id, identity_key) WHERE identity_key <> '';
      CREATE UNIQUE INDEX IF NOT EXISTS uq_submissions_exam_source_hash
      ON submissions(exam_id, source_hash) WHERE source_hash <> '';
    `);
  }

  private loadFromDb() {
    // 1. 读取 Exams
    const examRows = this.db.prepare("SELECT * FROM exams ORDER BY created_at DESC").all() as any[];
    if (examRows.length > 0) {
      examRows.forEach((row) => {
        let questions: Question[] = [];
        try {
          questions = JSON.parse(row.questions_json || "[]");
        } catch {}

        // 确保题目具有唯一 ID 且按题号/小问严格升序
        const seenIds = new Set<string>();
        questions.forEach((q, idx) => {
          if (!q.id || seenIds.has(q.id)) {
            const safeSubNum = q.sub_num ? q.sub_num.replace(/[^a-zA-Z0-9]/g, "_") : `${idx + 1}`;
            q.id = `q_${row.id}_${q.question_num}_${safeSubNum}`;
          }
          seenIds.add(q.id);
        });

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

        const exam: ExamPaper = {
          id: row.id,
          title: row.title,
          subject: row.subject,
          school_stage: row.school_stage,
          grade: row.grade,
          textbook_version: row.textbook_version || "统编版",
          publisher: row.publisher || "",
          edition_year: row.edition_year || "",
          semester: row.semester || "八年级上册",
          total_score: Number(row.total_score) || 0,
          status: row.status,
          file_path: row.file_path,
          source_files: (() => {
            try { return JSON.parse(row.source_files_json || "[]"); } catch { return row.file_path ? [row.file_path] : []; }
          })(),
          vision_pages: (() => { try { return JSON.parse(row.vision_pages_json || "[]"); } catch { return []; } })(),
          import_review_required: Boolean(row.import_review_required),
          created_at: row.created_at,
          questions,
        };
        this.exams.set(exam.id, exam);
      });
    }

    // 2. 读取 Submissions
    const subRows = this.db.prepare("SELECT * FROM submissions ORDER BY submitted_at DESC").all() as any[];
    if (subRows.length > 0) {
      subRows.forEach((row) => {
        let grading_details: GradingDetail[] = [];
        try {
          grading_details = JSON.parse(row.grading_details_json || "[]");
        } catch {}

        const sub: StudentSubmission = {
          id: row.id,
          exam_id: row.exam_id,
          student_id: row.student_id,
          student_number: row.student_number || "",
          student_name: row.student_name,
          class_name: row.class_name || "",
          identity_key: row.identity_key || "",
          source_hash: row.source_hash || "",
          source_file_name: row.source_file_name || "",
          import_batch_id: row.import_batch_id || "",
          status: row.status,
          total_score: Number(row.total_score) || 0,
          ai_score: Number(row.ai_score) || 0,
          source_files: (() => {
            try { return JSON.parse(row.source_files_json || "[]"); } catch { return []; }
          })(),
          identity_evidence: (() => { try { return JSON.parse(row.identity_evidence_json || "null") || undefined; } catch { return undefined; } })(),
          vision_answers: (() => { try { return JSON.parse(row.vision_answers_json || "[]"); } catch { return []; } })(),
          submitted_at: row.submitted_at,
          grading_details,
        };
        this.submissions.set(sub.id, sub);
      });
    }

    // 3. 读取 Agent Execution Logs
    const logRows = this.db
      .prepare("SELECT * FROM agent_execution_logs ORDER BY created_at DESC LIMIT 200")
      .all() as any[];
    if (logRows.length > 0) {
      this.executionLogs = logRows.map((r) => ({
        id: r.id,
        submission_id: r.submission_id,
        question_id: r.question_id,
        agent_name: r.agent_name,
        model: r.model,
        input_context: r.input_context,
        output_content: r.output_content,
        prompt_tokens: r.prompt_tokens,
        completion_tokens: r.completion_tokens,
        latency_ms: r.latency_ms,
        status: r.status,
        created_at: r.created_at,
      }));
    }

    const workflowRows = this.db.prepare("SELECT * FROM workflow_runs ORDER BY created_at DESC").all() as any[];
    for (const row of workflowRows) {
      this.workflowRuns.set(row.id, {
        id: row.id,
        workflow_type: row.workflow_type,
        resource_id: row.resource_id || undefined,
        status: row.status,
        attempt: Number(row.attempt) || 0,
        idempotency_key: row.idempotency_key || undefined,
        error_message: row.error_message || undefined,
        created_at: row.created_at,
        started_at: row.started_at || undefined,
        completed_at: row.completed_at || undefined,
      });
    }
    const stepRows = this.db.prepare("SELECT * FROM workflow_steps").all() as any[];
    for (const row of stepRows) {
      this.workflowSteps.set(row.id, {
        id: row.id,
        run_id: row.run_id,
        step_key: row.step_key,
        status: row.status,
        attempt: Number(row.attempt) || 0,
        input_json: row.input_json || undefined,
        output_json: row.output_json || undefined,
        error_message: row.error_message || undefined,
        started_at: row.started_at || undefined,
        completed_at: row.completed_at || undefined,
      });
    }

  }

  public createWorkflowRun(run: WorkflowRun): WorkflowRun {
    if (run.idempotency_key) {
      const existing = [...this.workflowRuns.values()].find((item) => item.idempotency_key === run.idempotency_key);
      if (existing) return existing;
    }
    this.workflowRuns.set(run.id, run);
    this.persistWorkflow(run);
    return run;
  }

  public getWorkflowRun(id: string): WorkflowRun | undefined {
    return this.workflowRuns.get(id);
  }

  public listWorkflowSteps(runId: string): WorkflowStep[] {
    return [...this.workflowSteps.values()].filter((step) => step.run_id === runId);
  }

  public updateWorkflowRun(id: string, patch: Partial<WorkflowRun>): WorkflowRun | undefined {
    const run = this.workflowRuns.get(id);
    if (!run) return undefined;
    Object.assign(run, patch);
    this.persistWorkflow(run);
    return run;
  }

  public createReviewTask(params: { submissionId: string; questionId: string; reason: string }): void {
    this.db.prepare(`
      INSERT INTO review_tasks (id, submission_id, question_id, reason, status, created_at)
      VALUES (?, ?, ?, ?, 'OPEN', ?)
      ON CONFLICT(id) DO NOTHING
    `).run(`review:${params.submissionId}:${params.questionId}`, params.submissionId, params.questionId,
      params.reason, new Date().toISOString());
  }

  public listReviewTasks(status = "OPEN"): any[] {
    return this.db.prepare("SELECT * FROM review_tasks WHERE status = ? ORDER BY created_at ASC").all(status) as any[];
  }

  public appendGradingEvent(submissionId: string, event: unknown): void {
    this.db.prepare("INSERT INTO grading_events (submission_id, event_json, created_at) VALUES (?, ?, ?)")
      .run(submissionId, JSON.stringify(event), new Date().toISOString());
  }

  public getGradingEvents(submissionId: string): any[] {
    return (this.db.prepare("SELECT id, event_json, created_at FROM grading_events WHERE submission_id = ? ORDER BY id ASC")
      .all(submissionId) as any[]).map((row) => ({ id: row.id, ...JSON.parse(row.event_json), createdAt: row.created_at }));
  }

  public resolveReviewTask(submissionId: string, questionId: string): void {
    this.db.prepare("UPDATE review_tasks SET status = 'RESOLVED', resolved_at = ? WHERE submission_id = ? AND question_id = ? AND status = 'OPEN'")
      .run(new Date().toISOString(), submissionId, questionId);
  }

  public upsertWorkflowStep(step: WorkflowStep): WorkflowStep {
    this.workflowSteps.set(step.id, step);
    this.db.prepare(`
      INSERT INTO workflow_steps (id, run_id, step_key, status, attempt, input_json, output_json, error_message, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, attempt=excluded.attempt,
        output_json=excluded.output_json, error_message=excluded.error_message,
        started_at=excluded.started_at, completed_at=excluded.completed_at
    `).run(step.id, step.run_id, step.step_key, step.status, step.attempt,
      step.input_json || null, step.output_json || null, step.error_message || null,
      step.started_at || null, step.completed_at || null);
    return step;
  }

  private persistWorkflow(run: WorkflowRun): void {
    this.db.prepare(`
      INSERT INTO workflow_runs (id, workflow_type, resource_id, status, attempt, idempotency_key, error_message, created_at, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, attempt=excluded.attempt,
        error_message=excluded.error_message, started_at=excluded.started_at, completed_at=excluded.completed_at
    `).run(run.id, run.workflow_type, run.resource_id || null, run.status, run.attempt,
      run.idempotency_key || null, run.error_message || null, run.created_at,
      run.started_at || null, run.completed_at || null);
  }

  /**
   * 删除指定试卷及关联的答卷数据
   */
  public deleteExam(examId: string) {
    this.exams.delete(examId);
    this.db.prepare("DELETE FROM exams WHERE id = ?").run(examId);
    
    // 同时清理该试卷关联的 submissions
    for (const [subId, sub] of this.submissions.entries()) {
      if (sub.exam_id === examId) {
        this.submissions.delete(subId);
      }
    }
    this.db.prepare("DELETE FROM submissions WHERE exam_id = ?").run(examId);
  }

  /**
   * 将当前内存状态完整同步落盘至 SQLite 数据库
   */
  public persist() {
    try {
      // 1. 同步 Exams
      const insertExam = this.db.prepare(`
        INSERT OR REPLACE INTO exams 
        (id, title, subject, school_stage, grade, textbook_version, publisher, edition_year, semester, total_score, status, file_path, source_files_json, vision_pages_json, import_review_required, created_at, questions_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      this.exams.forEach((exam) => {
        insertExam.run(
          exam.id,
          exam.title,
          exam.subject,
          exam.school_stage,
          exam.grade,
          exam.textbook_version,
          exam.publisher || "",
          exam.edition_year || "",
          exam.semester,
          exam.total_score,
          exam.status,
          exam.file_path || null,
          JSON.stringify(exam.source_files || (exam.file_path ? [exam.file_path] : [])),
          JSON.stringify(exam.vision_pages || []),
          exam.import_review_required ? 1 : 0,
          exam.created_at,
          JSON.stringify(exam.questions || [])
        );
      });

      // 2. 同步 Submissions
      const insertSub = this.db.prepare(`
        INSERT INTO submissions
        (id, exam_id, student_id, student_number, student_name, class_name, identity_key, source_hash, source_file_name, import_batch_id, status, total_score, ai_score, source_files_json, identity_evidence_json, vision_answers_json, submitted_at, grading_details_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          exam_id = excluded.exam_id,
          student_id = excluded.student_id,
          student_number = excluded.student_number,
          student_name = excluded.student_name,
          class_name = excluded.class_name,
          identity_key = excluded.identity_key,
          source_hash = excluded.source_hash,
          source_file_name = excluded.source_file_name,
          import_batch_id = excluded.import_batch_id,
          status = excluded.status,
          total_score = excluded.total_score,
          ai_score = excluded.ai_score,
          source_files_json = excluded.source_files_json,
          identity_evidence_json = excluded.identity_evidence_json,
          vision_answers_json = excluded.vision_answers_json,
          submitted_at = excluded.submitted_at,
          grading_details_json = excluded.grading_details_json
      `);

      this.submissions.forEach((sub) => {
        insertSub.run(
          sub.id,
          sub.exam_id,
          sub.student_id,
          sub.student_number || "",
          sub.student_name,
          sub.class_name || "",
          sub.identity_key || "",
          sub.source_hash || "",
          sub.source_file_name || "",
          sub.import_batch_id || "",
          sub.status,
          sub.total_score,
          sub.ai_score,
          JSON.stringify(sub.source_files || []),
          JSON.stringify(sub.identity_evidence || null),
          JSON.stringify(sub.vision_answers || []),
          sub.submitted_at,
          JSON.stringify(sub.grading_details || [])
        );
      });

      // 3. 同步 Execution Logs
      const insertLog = this.db.prepare(`
        INSERT OR REPLACE INTO agent_execution_logs
        (id, submission_id, question_id, agent_name, model, input_context, output_content, prompt_tokens, completion_tokens, latency_ms, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      this.executionLogs.slice(0, 50).forEach((l) => {
        insertLog.run(
          l.id,
          l.submission_id || null,
          l.question_id || null,
          l.agent_name,
          l.model,
          l.input_context,
          l.output_content,
          l.prompt_tokens,
          l.completion_tokens,
          l.latency_ms,
          l.status,
          l.created_at
        );
      });
    } catch (err: any) {
      console.warn(`[SQLite] Persist error: ${err.message}`);
    }
  }

  public deleteSubmission(submissionId: string) {
    this.submissions.delete(submissionId);
    this.executionLogs = this.executionLogs.filter((log) => log.submission_id !== submissionId);
    this.db.prepare("DELETE FROM agent_execution_logs WHERE submission_id = ?").run(submissionId);
    this.db.prepare("DELETE FROM submissions WHERE id = ?").run(submissionId);
  }

  private seedInitialData() {
    const examId = "exam_8th_chinese_01";
    const sampleExam: ExamPaper = {
      id: examId,
      title: "统编版八年级上册语文期末仿真调研卷",
      subject: "chinese",
      school_stage: "MIDDLE",
      grade: "初二",
      textbook_version: "统编版",
      semester: "八年级上册",
      total_score: 30,
      status: "AUDITED",
      created_at: new Date().toISOString(),
      questions: [
        {
          id: "q_01",
          exam_id: examId,
          question_num: 1,
          q_type: "SINGLE_CHOICE",
          stem_text: "下列各组词语中，加点字的读音完全正确的一项是 ( )",
          options: [
            "A. 畸形(jī)   匿名(nì)    杳无消息(yǎo)",
            "B. 炽热(zhì)  诘责(jié)   油光可鉴(jiàn)",
            "C. 禁锢(gù)   滞留(dài)   正襟危坐(jīn)",
            "D. 轩邈(miǎo) 经纶(lún)   鸢飞戾天(lì)",
          ],
          score_value: 3,
          standard_answer: {
            id: "sa_01",
            question_id: "q_01",
            correct_answer: "A",
            analysis: "B项炽热读音为chì；C项滞留读音为zhì；D项鸢飞戾天读音为lì正确，但选项排版以A为完全正确示范。",
            rubric_steps: [
              {
                step_no: 1,
                score: 3,
                criteria: "单项选择题判定：准确选出 A 项",
                keywords: ["A"],
              },
            ],
            is_teacher_edited: true,
          },
        },
        {
          id: "q_02",
          exam_id: examId,
          question_num: 2,
          q_type: "FILL_BLANK",
          stem_text: "古诗文名句默写：东风不与周郎便，_______________。（杜牧《赤壁》）",
          score_value: 2,
          standard_answer: {
            id: "sa_02",
            question_id: "q_02",
            correct_answer: "铜雀春深锁二乔",
            analysis: "出自杜牧《赤壁》，注意‘雀’与‘锁’字的准确书写，严防错别字。",
            rubric_steps: [
              {
                step_no: 1,
                score: 2,
                criteria: "准确无误默写出‘铜雀春深锁二乔’，字迹端正无错别字",
                keywords: ["铜雀春深锁二乔"],
              },
            ],
            is_teacher_edited: true,
          },
        },
        {
          id: "q_03",
          exam_id: examId,
          question_num: 3,
          q_type: "SUBJECTIVE_SHORT",
          stem_text: "【古诗赏析】请简析杜牧《赤壁》中后两句‘东风不与周郎便，铜雀春深锁二乔’所蕴含的艺术构思与作者主旨情感。(4分)",
          score_value: 4,
          standard_answer: {
            id: "sa_03",
            question_id: "q_03",
            correct_answer: "运用以小见大、借古讽今的手法，借由赤壁之战中东风的机缘侥幸，假设历史结局，深刻抒发了作者自己怀才不遇、英雄无用武之地的抑郁不平之气。",
            analysis: "第一步指出艺术手法（以小见大、反跌设想）；第二步剖析主旨情感（怀才不遇、壮志难酬）。",
            rubric_steps: [
              {
                step_no: 1,
                score: 2,
                criteria: "准确指出以小见大、假设历史或借古讽今等构思手法",
                keywords: ["以小见大", "借古讽今", "假设", "反跌", "手法"],
              },
              {
                step_no: 2,
                score: 2,
                criteria: "准确阐发怀才不遇、借三国兴亡抒发个人抱负不得施展的抑郁情感",
                keywords: ["怀才不遇", "抱负", "壮志难酬", "英雄无用武之地"],
              },
            ],
            is_teacher_edited: true,
          },
        },
        {
          id: "q_04",
          exam_id: examId,
          question_num: 4,
          q_type: "SUBJECTIVE_SHORT",
          stem_text: "【文言文阅读】结合《三峡》选段：‘自三峡七百里中，两岸连山，略无阙处。重岩叠嶂，隐天蔽日，自非亭午夜分，不见曦月。’请赏析作者是如何从正面与侧面结合描写三峡山势之高耸奇绝的。(5分)",
          score_value: 5,
          standard_answer: {
            id: "sa_04",
            question_id: "q_04",
            correct_answer: "正面描写：‘两岸连山，略无阙处。重岩叠嶂，隐天蔽日’，直接勾勒群山连绵、高耸遮天蔽日的雄伟雄姿；侧面描写：‘自非亭午夜分，不见曦月’，借唯有正午见日、半夜见月反衬山峰之高峻与峡谷之幽深狭窄。正侧结合，极富感染力。",
            analysis: "需答出正面描写及具体语句分析（2分），侧面描写及烘托效果（2分），综合结构表述（1分）。",
            rubric_steps: [
              {
                step_no: 1,
                score: 2,
                criteria: "分析正面描写：指出‘两岸连山’‘重岩叠嶂’直接体现山峰连绵与高峻",
                keywords: ["正面", "连山", "重岩叠嶂", "高峻", "遮天蔽日"],
              },
              {
                step_no: 2,
                score: 2,
                criteria: "分析侧面描写：指出‘不见曦月’侧面反衬峡谷幽深狭长、山势拔地而起",
                keywords: ["侧面", "反衬", "烘托", "不见曦月", "正午", "半夜", "幽深"],
              },
              {
                step_no: 3,
                score: 1,
                criteria: "指出正侧结合的艺术效果，表达严密",
                keywords: ["正侧结合", "生动", "形象"],
              },
            ],
            is_teacher_edited: true,
          },
        },
        {
          id: "q_05",
          exam_id: examId,
          question_num: 5,
          q_type: "SUBJECTIVE_SHORT",
          stem_text: "【现代文阅读·新闻探究】阅读《人民解放军百万大军横渡长江》中‘此处敌军抵抗较为顽强，然在二十一日下午至二十二日下午的整天激战中，我已歼灭及击溃一切抵抗之敌...’，分析加点词语‘歼灭及击溃’能否互换位置？为什么？(4分)",
          score_value: 4,
          standard_answer: {
            id: "sa_05",
            question_id: "q_05",
            correct_answer: "不能互换。‘歼灭’指全部消灭，‘击溃’指打散敌人残部。在语意上由重到轻，符合战场实际作战逻辑（先集中主力消灭敌军主力，随后追歼击散逃窜敌兵）；用词准确严密，体现新闻语言的真实性与客观性。",
            analysis: "先明确表态（1分），分别解释两词含义与语意轻重（2分），总结新闻语言准确严密特点（1分）。",
            rubric_steps: [
              {
                step_no: 1,
                score: 1,
                criteria: "明确回答‘不能互换’",
                keywords: ["不能", "不可"],
              },
              {
                step_no: 2,
                score: 2,
                criteria: "分别解释‘歼灭’(全部消灭)与‘击溃’(打垮/打散)的词义差异及逻辑递进关系",
                keywords: ["歼灭", "击溃", "全部消灭", "打散", "打垮", "轻重", "逻辑", "程度"],
              },
              {
                step_no: 3,
                score: 1,
                criteria: "指出符合新闻语言准确、严谨的文体特征",
                keywords: ["准确", "严密", "严谨", "新闻文体", "真实性"],
              },
            ],
            is_teacher_edited: true,
          },
        },
      ],
    };

    this.exams.set(sampleExam.id, sampleExam);

    const sub1: StudentSubmission = {
      id: "sub_101",
      exam_id: examId,
      student_id: "stu_202401",
      student_name: "张明远",
      class_name: "初二(3)班",
      status: "COMPLETED",
      total_score: 16,
      ai_score: 16,
      submitted_at: new Date(Date.now() - 3600000 * 2).toISOString(),
      grading_details: [
        {
          id: "gd_101_1",
          submission_id: "sub_101",
          question_id: "q_01",
          question_num: 1,
          question_type: "SINGLE_CHOICE",
          stem_text: sampleExam.questions[0].stem_text,
          student_answer: "A",
          final_score: 3,
          ai_score: 3,
          max_score: 3,
          score_status: "FULL_CORRECT",
          step_details: [
            {
              step_no: 1,
              score: 3,
              max_score: 3,
              is_hit: true,
              evidence: "A",
              reason: "选择正确",
            },
          ],
          ai_feedback: "字音辨析准确，基础扎实！",
          confidence: 0.99,
          is_reviewed: true,
        },
        {
          id: "gd_101_2",
          submission_id: "sub_101",
          question_id: "q_02",
          question_num: 2,
          question_type: "FILL_BLANK",
          stem_text: sampleExam.questions[1].stem_text,
          student_answer: "铜雀春深锁二乔",
          final_score: 2,
          ai_score: 2,
          max_score: 2,
          score_status: "FULL_CORRECT",
          step_details: [
            {
              step_no: 1,
              score: 2,
              max_score: 2,
              is_hit: true,
              evidence: "铜雀春深锁二乔",
              reason: "默写完全无误",
            },
          ],
          ai_feedback: "默写工整，准确无误。",
          confidence: 0.98,
          is_reviewed: true,
        },
        {
          id: "gd_101_3",
          submission_id: "sub_101",
          question_id: "q_03",
          question_num: 3,
          question_type: "SUBJECTIVE_SHORT",
          stem_text: sampleExam.questions[2].stem_text,
          student_answer: "作者借古讽今，借东风的侥幸来假设战争结果，抒发了自己怀才不遇、壮志难酬的郁闷之情。",
          final_score: 4,
          ai_score: 4,
          max_score: 4,
          score_status: "FULL_CORRECT",
          step_details: [
            {
              step_no: 1,
              score: 2,
              max_score: 2,
              is_hit: true,
              evidence: "借古讽今，借东风的侥幸来假设战争结果",
              reason: "命中以小见大、假设历史构思手法",
            },
            {
              step_no: 2,
              score: 2,
              max_score: 2,
              is_hit: true,
              evidence: "抒发了自己怀才不遇、壮志难酬的郁闷之情",
              reason: "准确命中怀才不遇的主旨情感要点",
            },
          ],
          ai_feedback: "构思手法与情感主旨回答全面精准，学科术语使用规范！",
          confidence: 0.96,
          is_reviewed: false,
        },
        {
          id: "gd_101_4",
          submission_id: "sub_101",
          question_id: "q_04",
          question_num: 4,
          question_type: "SUBJECTIVE_SHORT",
          stem_text: sampleExam.questions[3].stem_text,
          student_answer: "正面写了两岸连山、隐天蔽日说明山多；侧面写不到中午半夜看不到太阳月亮，说明山很高。",
          final_score: 4,
          ai_score: 4,
          max_score: 5,
          score_status: "PARTIAL_CORRECT",
          step_details: [
            {
              step_no: 1,
              score: 2,
              max_score: 2,
              is_hit: true,
              evidence: "正面写了两岸连山、隐天蔽日说明山多",
              reason: "正面描写分析基本到位",
            },
            {
              step_no: 2,
              score: 2,
              max_score: 2,
              is_hit: true,
              evidence: "侧面写不到中午半夜看不到太阳月亮，说明山很高",
              reason: "侧面烘托要点准确",
            },
            {
              step_no: 3,
              score: 0,
              max_score: 1,
              is_hit: false,
              evidence: "未总结正侧结合的艺术效果",
              reason: "缺少对正侧结合艺术手法的综合概括",
            },
          ],
          error_type: "LOGIC_STEP_MISSING",
          ai_feedback: "能够分别指出正面和侧面描写的语句，但建议结尾补充‘正侧结合，全面展现了三峡高峻幽深的特点’等总结性评述。",
          confidence: 0.93,
          is_reviewed: false,
        },
        {
          id: "gd_101_5",
          submission_id: "sub_101",
          question_id: "q_05",
          question_num: 5,
          question_type: "SUBJECTIVE_SHORT",
          stem_text: sampleExam.questions[4].stem_text,
          student_answer: "不能换。因为歼灭是全部消灭，击溃只是打散。先消灭后打散符合实际打仗过程，体现了新闻准确性。",
          final_score: 3,
          ai_score: 3,
          max_score: 4,
          score_status: "PARTIAL_CORRECT",
          step_details: [
            {
              step_no: 1,
              score: 1,
              max_score: 1,
              is_hit: true,
              evidence: "不能换",
              reason: "明确表态正确",
            },
            {
              step_no: 2,
              score: 2,
              max_score: 2,
              is_hit: true,
              evidence: "歼灭是全部消灭，击溃只是打散",
              reason: "词义辨析准确",
            },
            {
              step_no: 3,
              score: 0,
              max_score: 1,
              is_hit: false,
              evidence: "体现了新闻准确性",
              reason: "缺少对语意由重到轻程度递进关系的深入说明",
            },
          ],
          error_type: "EXPRESSION_BIAS",
          ai_feedback: "表态与词义解释正确，建议进一步强调两词在‘语意轻重程度’上的逻辑递进关系。",
          confidence: 0.94,
          is_reviewed: false,
        },
      ],
    };

    this.submissions.set(sub1.id, sub1);
  }
}

export const store = new SqliteStore();
