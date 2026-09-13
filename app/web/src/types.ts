export interface RubricStep {
  step_no: number;
  score: number;
  criteria: string;
  keywords: string[];
}

export interface StandardAnswer {
  id: string;
  version_id?: string;
  question_id: string;
  correct_answer: string;
  analysis: string;
  rubric_steps: RubricStep[];
  is_teacher_edited: boolean;
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
}

export interface StepEvaluation {
  step_no: number;
  score: number;
  max_score: number;
  is_hit: boolean;
  evidence: string;
  reason?: string;
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
  step_details: StepEvaluation[];
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
  source_files?: string[];
  identity_evidence?: {
    studentName: string;
    className: string;
    studentNumber: string;
    confidence: number;
    evidence: string;
  };
  vision_answers?: VisionAnswerEvidence[];
  status: "SUBMITTED" | "QUEUED" | "GRADING" | "RETRYING" | "REVIEW_PENDING" | "COMPLETED" | "FAILED";
  total_score: number;
  ai_score: number;
  submitted_at: string;
  grading_details: GradingDetail[];
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

export interface ClassAnalytics {
  classList?: string[];
  selectedClass?: string;
  totalStudents: number;
  totalExamScore: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
  scoreDistribution: Array<{ range: string; count: number }>;
  questionAccuracy: Array<{ questionNum: number; questionType: string; scoreValue: number; accuracyRate: number }>;
  errorTypeBreakdown: Record<"KNOWLEDGE_GAP" | "LOGIC_STEP_MISSING" | "EXPRESSION_BIAS" | "CALC_ERROR", number>;
  errorTypeTotal: number;
  rubricCoverageRate: number;
}
