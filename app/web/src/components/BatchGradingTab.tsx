import React, { useState, useEffect, useRef } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  Activity,
  Layers,
  ArrowRight,
  Terminal,
  RotateCcw,
  RotateCw,
  Scissors,
  UploadCloud,
  FileText,
  School,
  AlertCircle,
  Bot,
  ChevronDown,
  CircleAlert,
  FileSearch,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { ExamPaper, StudentSubmission, AgentExecutionLog } from "../types.js";
import { formatQuestionLabel } from "../utils/question-label.js";

interface BatchGradingTabProps {
  selectedExam: ExamPaper | null;
  submissions: StudentSubmission[];
  onSelectSubmission: (submissionId: string) => void;
  onRefreshSubmissions: () => void;
}

interface StudentAnswerPreviewItem {
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
  duplicate?: {
    type: "EXACT_FILE" | "SAME_STUDENT";
    submissionId: string;
    studentName: string;
  };
  warnings: string[];
  duplicateAction: "SKIP" | "REPLACE";
}

type ImageRotation = 0 | 90 | 180 | 270;

interface UploadFileItem {
  key: string;
  file: File;
  rotation: ImageRotation;
  splitPages: boolean;
  width?: number;
  height?: number;
  orientationHint?: string;
}

interface AnswerSheetPreviewCardProps {
  item: UploadFileItem;
  onRotate: (direction: "left" | "right") => void;
  onSplitChange: (splitPages: boolean) => void;
  onDimensions: (width: number, height: number) => void;
  onRemove: () => void;
}

const AnswerSheetPreviewCard: React.FC<AnswerSheetPreviewCardProps> = ({
  item,
  onRotate,
  onSplitChange,
  onDimensions,
  onRemove,
}) => {
  const [previewUrl, setPreviewUrl] = useState("");
  const isImage = item.file.type.startsWith("image/");

  useEffect(() => {
    if (!isImage) return;
    const nextUrl = URL.createObjectURL(item.file);
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [isImage, item.file]);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="relative flex h-40 items-center justify-center overflow-hidden bg-slate-100">
        {isImage && previewUrl ? (
          <img
            src={previewUrl}
            alt={`${item.file.name} 方向预览`}
            onLoad={(event) => onDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
            className="h-full w-full object-contain transition-transform duration-200"
            style={{
              transform: `rotate(${item.rotation}deg) scale(${item.rotation % 180 === 0 ? 0.94 : 0.72})`,
            }}
          />
        ) : (
          <FileText className="h-10 w-10 text-slate-400" />
        )}
        <span className="absolute left-2 top-2 rounded-md bg-slate-900/75 px-2 py-1 text-[10px] font-semibold text-white">
          {item.rotation}°
        </span>
        <button
          type="button"
          aria-label={`移除 ${item.file.name}`}
          onClick={onRemove}
          className="absolute right-2 top-2 rounded-md bg-white/90 px-2 py-1 text-xs text-slate-500 shadow-sm hover:text-rose-600"
        >
          ✕
        </button>
      </div>
      <div className="space-y-2 p-3">
        <p className="truncate text-xs font-semibold text-slate-700" title={item.file.name}>{item.file.name}</p>
        {item.orientationHint && item.rotation === 0 && (
          <p className="rounded-md bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">{item.orientationHint}</p>
        )}
        {isImage ? (
          <>
            <div className="flex gap-2">
              <button type="button" onClick={() => onRotate("left")} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-700">
                <RotateCcw className="h-3.5 w-3.5" /> 左转
              </button>
              <button type="button" onClick={() => onRotate("right")} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-blue-300 hover:text-blue-700">
                <RotateCw className="h-3.5 w-3.5" /> 右转
              </button>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-600">
              <input type="checkbox" checked={item.splitPages} onChange={(event) => onSplitChange(event.target.checked)} className="rounded border-slate-300 text-blue-600" />
              <Scissors className="h-3.5 w-3.5 text-blue-500" />
              左右双页，沿中缝拆分后识别
            </label>
          </>
        ) : (
          <p className="text-[11px] text-slate-500">仅支持图片，Pi Agent 按上传顺序直接分析</p>
        )}
      </div>
    </div>
  );
};

const createUploadFileKey = (file: File): string => `${file.name}:${file.size}:${file.lastModified}`;

const rotateImage = (rotation: ImageRotation, direction: "left" | "right"): ImageRotation =>
  ((rotation + (direction === "left" ? 270 : 90)) % 360) as ImageRotation;

const shouldSuggestPageSplit = (item: UploadFileItem, rotation = item.rotation): boolean => {
  if (!item.width || !item.height) return false;
  const width = rotation % 180 === 0 ? item.width : item.height;
  const height = rotation % 180 === 0 ? item.height : item.width;
  return width / height >= 1.55;
};

type TraceFilter = "ALL" | "SUCCESS" | "ATTENTION";

const getTraceQuestionLabel = (log: AgentExecutionLog, exam: ExamPaper | null): string => {
  const question = exam?.questions.find((item) => item.id === log.question_id);
  if (!question) return "题目处理中";
  return formatQuestionLabel(question.question_num, question.sub_num);
};

const getTracePrompt = (context: string): string => {
  try {
    const parsed = JSON.parse(context) as { stem?: unknown; question?: { stem?: unknown } };
    if (typeof parsed.stem === "string") return parsed.stem;
    if (typeof parsed.question?.stem === "string") return parsed.question.stem;
  } catch {
    const stemMatch = context.match(/\"stem\"\s*:\s*\"((?:\\.|[^\"])*)\"/);
    if (stemMatch) {
      try {
        return JSON.parse(`\"${stemMatch[1]}\"`);
      } catch {
        // Fall through to the shortened raw context below.
      }
    }
  }
  return context.replace(/^Prompt:\s*/, "").slice(0, 220) || "未记录题目内容";
};

const formatTraceTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const formatTraceLatency = (latency: number): string =>
  latency >= 1000 ? `${(latency / 1000).toFixed(1)} 秒` : `${latency} 毫秒`;

const traceStatusCopy = (status: AgentExecutionLog["status"]) => {
  if (status === "SUCCESS") {
    return { label: "批改完成", description: "AI 已完成分析，结果已写入批改记录。", tone: "success" as const };
  }
  if (status === "BLOCKED") {
    return { label: "需要人工关注", description: "这次分析没有自动完成，请老师查看后再确认。", tone: "attention" as const };
  }
  return { label: "处理失败", description: "这次分析没有成功完成，可以稍后重试。", tone: "error" as const };
};

export const BatchGradingTab: React.FC<BatchGradingTabProps> = ({
  selectedExam,
  submissions,
  onSelectSubmission,
  onRefreshSubmissions,
}) => {
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [progressEvent, setProgressEvent] = useState<{
    stage: string;
    message: string;
    progressPercent: number;
    submissionId?: string;
  } | null>(null);
  const [traces, setTraces] = useState<AgentExecutionLog[]>([]);
  const [traceFilter, setTraceFilter] = useState<TraceFilter>("ALL");
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);

  // 答卷上传 Modal 状态
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadClassName, setUploadClassName] = useState("");
  const [uploadItems, setUploadItems] = useState<UploadFileItem[]>([]);
  const [orientationConfirmed, setOrientationConfirmed] = useState(false);
  const [previewBatchId, setPreviewBatchId] = useState("");
  const [previewItems, setPreviewItems] = useState<StudentAnswerPreviewItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [importNotice, setImportNotice] = useState("");
  const [retryingSubmissionId, setRetryingSubmissionId] = useState<string | null>(null);
  const [selectedSubmissionRowId, setSelectedSubmissionRowId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const examSubmissions = selectedExam
    ? submissions.filter((s) => s.exam_id === selectedExam.id)
    : submissions;
  const requiresOrientationConfirmation = uploadItems.some((item) => item.file.type.startsWith("image/"));
  const canStartVision = uploadItems.length > 0 && (!requiresOrientationConfirmation || orientationConfirmed);

  const fetchTraces = async () => {
    try {
      const res = await fetch("/api/traces");
      if (res.ok) {
        setTraces(await res.json());
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchTraces();
    const traceInterval = setInterval(fetchTraces, 4000);
    // Rehydrate progress after navigating away: SSE only delivers future events,
    // so polling the persisted submission statuses is the source of truth.
    const submissionInterval = setInterval(onRefreshSubmissions, 4000);
    return () => {
      clearInterval(traceInterval);
      clearInterval(submissionInterval);
    };
  }, []);

  const activeSubmissions = examSubmissions.filter((submission) =>
    ["QUEUED", "GRADING", "RETRYING"].includes(submission.status)
  );

  useEffect(() => {
    if (activeSubmissions.length > 0) {
      setIsBatchRunning(true);
      setProgressEvent((previous) => previous || {
        stage: "GRADING",
        message: `已恢复批改进度，当前还有 ${activeSubmissions.length} 份答卷处理中`,
        progressPercent: 0,
      });
    } else if (isBatchRunning) {
      setIsBatchRunning(false);
    }
  }, [submissions, selectedExam?.id]);

  const connectSSE = (expectedCount = 1) => {
    const eventSource = new EventSource("/api/grading/sse/all");
    const completed = new Set<string>();
    eventSource.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.stage) {
          setProgressEvent(payload);
          if (payload.stage === "GRADING_COMPLETED") {
            if (payload.submissionId) completed.add(payload.submissionId);
            onRefreshSubmissions();
            fetchTraces();
            if (completed.size >= expectedCount) {
              setIsBatchRunning(false);
              setIsUploading(false);
              eventSource.close();
            }
          }
        }
      } catch {
        // ignore
      }
    };
  };

  const openReupload = (submission: StudentSubmission) => {
    // Reuse the audited import flow: the teacher can rotate the new image,
    // review the vision result, then choose REPLACE for the existing student.
    setUploadClassName(submission.class_name || "");
    setUploadItems([]);
    setPreviewBatchId("");
    setPreviewItems([]);
    setUploadError("");
    setUploadStep(`正在为 ${submission.student_name} 重新上传答卷`);
    setOrientationConfirmed(false);
    setSelectedSubmissionRowId(submission.id);
    setShowUploadModal(true);
  };

  const retrySubmission = async (submission: StudentSubmission) => {
    if (retryingSubmissionId) return;
    setRetryingSubmissionId(submission.id);
    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(submission.id)}/retry`, {
        method: "POST",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "重新批改失败");
      setIsBatchRunning(true);
      onRefreshSubmissions();
      connectSSE(1);
    } catch (error: any) {
      const message = error.message || "重新批改失败";
      setUploadError(message);
      setImportNotice(message);
    } finally {
      setRetryingSubmissionId(null);
    }
  };

  const addStudentFiles = (files: File[]) => {
    setUploadItems((current) => {
      const seen = new Set(current.map((item) => item.key));
      const additions = files.filter((file) => {
        const key = createUploadFileKey(file);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).map((file) => ({
        key: createUploadFileKey(file),
        file,
        rotation: 0 as ImageRotation,
        splitPages: false,
      }));
      return [...current, ...additions].slice(0, 100);
    });
    setOrientationConfirmed(false);
    setPreviewBatchId("");
    setPreviewItems([]);
  };

  const resetVisionUpload = (discardPreview = true) => {
    if (discardPreview && previewBatchId) {
      void fetch(`/api/submissions/import-batches/${encodeURIComponent(previewBatchId)}`, { method: "DELETE" });
    }
    setUploadItems([]);
    setOrientationConfirmed(false);
    setPreviewBatchId("");
    setPreviewItems([]);
    setUploadError("");
    setUploadStep("");
  };

  // 1. 批量视觉分析，只生成可校对预览，不直接创建或批改答卷。
  const handlePreviewFiles = async () => {
    if (!selectedExam || uploadItems.length === 0) return;
    const hasImages = uploadItems.some((item) => item.file.type.startsWith("image/"));
    if (hasImages && !orientationConfirmed) {
      setUploadError("请先逐张检查答卷方向，并勾选“已确认所有图片为对应答卷原图”后再识别");
      return;
    }
    setIsUploading(true);
    setUploadError("");
    setUploadStep(`正在读取原始图片并分析 ${uploadItems.length} 个答卷文件...`);

    try {
      const formData = new FormData();
      uploadItems.forEach((item) => formData.append("files", item.file));
      formData.append("rotations", JSON.stringify(uploadItems.map((item) => item.rotation)));
      formData.append("splitPages", JSON.stringify(uploadItems.map((item) => item.splitPages)));
      formData.append("examId", selectedExam.id);
      formData.append("defaultClassName", uploadClassName.trim());

      const res = await fetch("/api/submissions/preview-files", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "批量答卷视觉分析失败");
      }
      const data = await res.json();
      const skippedCount = Array.isArray(data.skipped) ? data.skipped.length : 0;
      const previewCount = Number(data.count) || (Array.isArray(data.items) ? data.items.length : 0);
      setImportNotice(
        `视觉预览已生成：${previewCount} 份答卷待确认${skippedCount > 0 ? `，安全跳过 ${skippedCount} 个重复文件/学生` : ""}。`
      );
      fetchTraces();
      setPreviewBatchId(data.batchId);
      setPreviewItems(data.items.map((item: StudentAnswerPreviewItem) => ({
        ...item,
        // Re-importing the same student is an intentional correction workflow:
        // keep the newest answer sheet and replace the stale record by default.
        // The teacher can still switch back to SKIP in the duplicate selector.
        duplicateAction: item.duplicate ? "REPLACE" : "SKIP",
      })));
      setUploadStep("");
    } catch (err: any) {
      setUploadError(err.message || "批量识别异常");
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirmBatch = async () => {
    if (!selectedExam || !previewBatchId || previewItems.length === 0) return;
    const incomplete = previewItems.find((item) => !item.studentName.trim() || !item.className.trim());
    if (incomplete) {
      setUploadError(`请补全【${incomplete.originalName}】的学生姓名和班级`);
      return;
    }
    setIsUploading(true);
    setUploadError("");
    setUploadStep("正在进行重复校验并创建批改任务...");
    try {
      const res = await fetch("/api/submissions/confirm-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: previewBatchId,
          examId: selectedExam.id,
          items: previewItems.map((item) => ({
            id: item.id,
            studentName: item.studentName.trim(),
            className: item.className.trim(),
            studentNumber: item.studentNumber.trim(),
            duplicateAction: item.duplicateAction,
          })),
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "批量答卷确认失败");
      }
      const data = await res.json();
      setShowUploadModal(false);
      resetVisionUpload(false);
      const skippedCount = Array.isArray(data.skipped) ? data.skipped.length : 0;
      setImportNotice(
        data.submissionIds?.length
          ? `已导入 ${data.submissionIds.length} 份答卷${skippedCount ? `，跳过 ${skippedCount} 份重复答卷` : ""}。`
          : `未创建新答卷：跳过 ${skippedCount} 份重复答卷，请选择“覆盖并重新批改”。`
      );
      onRefreshSubmissions();
      if (data.count > 0) {
        setIsBatchRunning(true);
        connectSSE(data.count);
      }
    } catch (err: any) {
      setUploadError(err.message || "批量确认异常");
    } finally {
      setIsUploading(false);
    }
  };

  const totalTokens = traces.reduce(
    (sum, trace) => sum + trace.prompt_tokens + trace.completion_tokens,
    0
  );
  const avgLatency =
    traces.length > 0
      ? Math.round(traces.reduce((a, b) => a + b.latency_ms, 0) / traces.length)
      : 0;
  const gradingDetails = examSubmissions.flatMap((submission) => submission.grading_details);
  const evidenceCoverage = gradingDetails.length > 0
    ? Math.round(
        (gradingDetails.filter((detail) => detail.step_details?.length > 0).length /
          gradingDetails.length) *
          1000
      ) / 10
    : 0;
  const successfulTraceCount = traces.filter((trace) => trace.status === "SUCCESS").length;
  const attentionTraceCount = traces.filter((trace) => trace.status !== "SUCCESS").length;
  const visibleTraces = traces
    .filter((trace) => traceFilter === "ALL" || (traceFilter === "SUCCESS" ? trace.status === "SUCCESS" : trace.status !== "SUCCESS"))
    .slice(0, 8);

  return (
    <div className="space-y-6">
      {/* Top Action & Real-time Progress Bar */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-600" />
              作业批量批改工作台 (Batch Grading Dashboard)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              通过 <code className="text-indigo-600 font-mono">ChineseExpertAgentPool</code> 集中式连接池执行高并发、带证据链核验的自动化批改
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* 导入学生答卷按钮 - 录入后立即自动开始批改流水线 */}
            <button
              onClick={() => {
                setShowUploadModal(true);
                setUploadError("");
                setUploadStep("");
              }}
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-600/30 transition cursor-pointer"
            >
              <UploadCloud className="w-4 h-4 text-white" />
              <span>导入/上传学生答卷</span>
            </button>
          </div>
        </div>

        {/* Live SSE Progress Banner */}
        {progressEvent && (isBatchRunning || activeSubmissions.length > 0) && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-xl border border-blue-200/80 space-y-2 animate-in fade-in duration-200">
            <div className="flex items-center justify-between text-xs font-semibold text-blue-900">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
                【阶段】：{progressEvent.stage} - {progressEvent.message}
              </span>
              <span>{activeSubmissions.length > 0 ? `处理中 ${activeSubmissions.length} 份` : `${progressEvent.progressPercent}%`}</span>
            </div>

            <div className="w-full bg-blue-200/60 rounded-full h-2 overflow-hidden">
              <div
                className={`bg-gradient-to-r from-blue-600 to-indigo-600 h-2 rounded-full transition-all duration-300 ${activeSubmissions.length > 0 && progressEvent.progressPercent === 0 ? "w-1/3 animate-pulse" : ""}`}
                style={activeSubmissions.length > 0 && progressEvent.progressPercent === 0 ? undefined : { width: `${progressEvent.progressPercent}%` }}
              />
            </div>
          </div>
        )}
        {importNotice && !isBatchRunning && (
          <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
            <span>{importNotice}</span>
            <button type="button" aria-label="关闭导入结果提示" onClick={() => setImportNotice("")} className="ml-3 text-emerald-600 hover:text-emerald-800">✕</button>
          </div>
        )}
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>当前试卷批改答卷</span>
            <CheckCircle2 className="w-4 h-4 text-blue-600" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {examSubmissions.length} <span className="text-xs font-normal text-slate-400">份</span>
          </p>
          <span className="text-[11px] text-emerald-600 font-medium">
            {evidenceCoverage}% 具备分步采分证据
          </span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>AI 处理记录</span>
            <Terminal className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {traces.length} <span className="text-xs font-normal text-slate-400">次</span>
          </p>
          <span className="text-[11px] text-indigo-600 font-medium">
            每道题都保留处理记录
          </span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>平均批改耗时</span>
            <Clock className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {avgLatency} <span className="text-xs font-normal text-slate-400">ms / 题</span>
          </p>
          <span className="text-[11px] text-emerald-600 font-medium">
            根据真实 Trace 日志计算
          </span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>AI 处理用量</span>
            <Activity className="w-4 h-4 text-amber-600" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {totalTokens.toLocaleString()}
          </p>
          <span className="text-[11px] text-amber-600 font-medium">
            用于了解本次批改的资源消耗
          </span>
        </div>
      </div>

      {/* Submissions Table & Trace Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Class Submissions Score Matrix */}
        <div className="lg:col-span-7 bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              班级学生答卷批改总表 ({examSubmissions.length})
              {selectedExam?.version_id && <span className="ml-2 text-[10px] font-normal text-slate-400">版本 {selectedExam.version_id}</span>}
            </h3>
            <button
              onClick={onRefreshSubmissions}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" /> 刷新数据
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg">
            <div className="mb-2 text-[11px] text-slate-400 sm:hidden">表格较宽时可左右滑动；学生姓名已固定在左侧，方便与操作按钮对应。</div>
            <table className="w-full min-w-[980px] table-fixed text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="sticky left-0 z-20 w-[13%] min-w-[128px] bg-slate-50 py-3 px-3 shadow-[2px_0_4px_rgba(15,23,42,0.06)]">学生姓名</th>
                  <th className="w-[11%] py-3 px-3">所属班级</th>
                  <th className="w-[16%] py-3 px-3 whitespace-nowrap">得分 / 满分</th>
                  <th className="w-[19%] py-3 px-3 whitespace-nowrap">批改状态</th>
                  <th className="w-[10%] py-3 px-3 whitespace-nowrap">置信度</th>
                  <th className="w-[31%] py-3 px-3 text-center whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {examSubmissions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">
                      暂无真实答卷，请点击“导入/上传学生答卷”开始批改。
                    </td>
                  </tr>
                )}
                {examSubmissions.map((sub) => {
                  // A low-confidence result is a reason to review, not a permanent
                  // status. Once the teacher confirms the score, it must disappear
                  // from the class summary.
                  const reviewCount = sub.grading_details.filter(
                    (d) => d.review_required && !d.is_reviewed
                  ).length;
                  const hasLowConfidence = reviewCount > 0;
                  return (
                    <tr
                      key={sub.id}
                      onClick={() => setSelectedSubmissionRowId(sub.id)}
                      className={`group transition cursor-pointer ${selectedSubmissionRowId === sub.id ? "bg-blue-50/80" : "hover:bg-slate-50/80"}`}
                    >
                      <td className={`sticky left-0 z-10 min-w-[128px] py-3.5 px-3 font-bold text-slate-800 shadow-[2px_0_4px_rgba(15,23,42,0.06)] ${selectedSubmissionRowId === sub.id ? "bg-blue-50/80" : "bg-white group-hover:bg-slate-50"}`}>
                        {sub.student_name}
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {sub.class_name || "未填写班级"}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className="font-extrabold text-sm text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                          {sub.total_score} 分
                        </span>
                        <span className="text-slate-400 text-[11px] ml-1">
                          / {selectedExam?.total_score || 0}
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        {sub.status === "REVIEW_PENDING" || sub.status === "FAILED" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            <AlertTriangle className="w-3 h-3" /> 待复核 ({reviewCount})
                          </span>
                        ) : sub.status === "COMPLETED" ? (
                          hasLowConfidence ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              <AlertTriangle className="w-3 h-3" /> 待复核 ({reviewCount})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3" /> 批改完成
                            </span>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
                            批改中...
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-slate-600 font-mono">
                        {sub.grading_details.length > 0
                          ? `${(
                              (sub.grading_details.reduce((sum, detail) => sum + detail.confidence, 0) /
                                sub.grading_details.length) *
                              100
                            ).toFixed(1)}%`
                          : "--"}
                      </td>
                      <td className="py-3.5 px-3 text-center whitespace-nowrap">
                        <div className="flex flex-nowrap justify-center items-center gap-2">
                          <button
                            onClick={() => onSelectSubmission(sub.id)}
                            className="inline-flex min-w-[132px] justify-center items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition cursor-pointer whitespace-nowrap"
                          >
                            <span>查看证据链报告</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                          {(sub.status === "GRADING" || sub.status === "FAILED" || sub.status === "RETRYING") && (
                            <button
                              onClick={() => void retrySubmission(sub)}
                              disabled={retryingSubmissionId !== null}
                              className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 px-3 py-1.5 rounded-lg transition cursor-pointer"
                              title="重新识别答卷并启动批改"
                            >
                              <RotateCcw className={`w-3 h-3 ${retryingSubmissionId === sub.id ? "animate-spin" : ""}`} />
                              <span>{retryingSubmissionId === sub.id ? "重试中" : "重新批改"}</span>
                            </button>
                          )}
                          <button
                            onClick={() => openReupload(sub)}
                            disabled={isUploading || retryingSubmissionId !== null}
                            className="inline-flex min-w-[106px] justify-center items-center gap-1 text-xs font-bold text-indigo-700 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 px-3 py-1.5 rounded-lg transition cursor-pointer whitespace-nowrap"
                            title="上传修正方向后的答卷，识别确认后覆盖原记录并重新批改"
                          >
                            <UploadCloud className="w-3 h-3" />
                            <span>重新上传</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Human-readable Agent Execution Trace */}
        <div className="lg:col-span-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-gradient-to-br from-indigo-50 via-white to-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-indigo-600 p-2.5 text-white shadow-sm shadow-indigo-200">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                    AI 批改过程
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> 实时更新
                    </span>
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    每条记录代表 AI 处理过的一道题。展开记录可查看题目和原始审计信息。
                  </p>
                </div>
              </div>
              <Sparkles className="mt-1 h-4 w-4 shrink-0 text-indigo-300" />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white/80 bg-white/80 px-3 py-2.5">
                <p className="text-[10px] font-medium text-slate-400">处理总数</p>
                <p className="mt-0.5 text-lg font-extrabold text-slate-900">{traces.length}</p>
              </div>
              <div className="rounded-xl border border-white/80 bg-white/80 px-3 py-2.5">
                <p className="text-[10px] font-medium text-slate-400">已完成</p>
                <p className="mt-0.5 text-lg font-extrabold text-emerald-600">{successfulTraceCount}</p>
              </div>
              <div className="rounded-xl border border-white/80 bg-white/80 px-3 py-2.5">
                <p className="text-[10px] font-medium text-slate-400">需关注</p>
                <p className={`mt-0.5 text-lg font-extrabold ${attentionTraceCount > 0 ? "text-amber-600" : "text-slate-400"}`}>
                  {attentionTraceCount}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {([
                ["ALL", "全部"],
                ["SUCCESS", "已完成"],
                ["ATTENTION", "需关注"],
              ] as const).map(([filter, label]) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setTraceFilter(filter)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                    traceFilter === filter
                      ? "bg-white text-indigo-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-slate-400">最近 {Math.min(visibleTraces.length, 8)} 条</span>
          </div>

          <div className="max-h-[535px] overflow-y-auto px-5 py-4">
            {visibleTraces.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="rounded-full bg-slate-100 p-3 text-slate-400"><FileSearch className="h-5 w-5" /></div>
                <p className="mt-3 text-sm font-semibold text-slate-600">
                  {traces.length === 0 ? "还没有 AI 批改记录" : "这个分类下暂无记录"}
                </p>
                <p className="mt-1 max-w-[220px] text-xs leading-5 text-slate-400">
                  {traces.length === 0 ? "导入学生答卷并开始批改后，处理过程会显示在这里。" : "可以切换上方分类查看其他处理记录。"}
                </p>
              </div>
            ) : (
              <div className="relative space-y-3">
                <div className="absolute bottom-5 left-[11px] top-5 w-px bg-slate-200" />
                {visibleTraces.map((log) => {
                  const status = traceStatusCopy(log.status);
                  const isExpanded = expandedTraceId === log.id;
                  const isSuccess = status.tone === "success";
                  const isAttention = status.tone === "attention";
                  return (
                    <div key={log.id} className="relative pl-8">
                      <div className={`absolute left-0 top-5 z-10 flex h-6 w-6 items-center justify-center rounded-full border-4 border-white ${
                        isSuccess ? "bg-emerald-500" : isAttention ? "bg-amber-500" : "bg-rose-500"
                      }`}>
                        {isSuccess ? <CheckCircle2 className="h-3 w-3 text-white" /> : isAttention ? <CircleAlert className="h-3 w-3 text-white" /> : <XCircle className="h-3 w-3 text-white" />}
                      </div>
                      <div className={`overflow-hidden rounded-xl border transition ${
                        isExpanded ? "border-indigo-200 bg-indigo-50/30 shadow-sm" : "border-slate-200 bg-white hover:border-indigo-200 hover:shadow-sm"
                      }`}>
                        <button
                          type="button"
                          onClick={() => setExpandedTraceId(isExpanded ? null : log.id)}
                          className="w-full cursor-pointer p-3.5 text-left"
                          aria-expanded={isExpanded}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${
                              isSuccess ? "text-emerald-700" : isAttention ? "text-amber-700" : "text-rose-700"
                            }`}>
                              {status.label}
                              <span className="font-normal text-slate-400">· {getTraceQuestionLabel(log, selectedExam)}</span>
                            </span>
                            <span className="shrink-0 text-[10px] text-slate-400">{formatTraceTime(log.created_at)}</span>
                          </div>
                          <p className="mt-1.5 text-xs font-semibold leading-5 text-slate-800">{status.description}</p>
                          <p className="mt-1 truncate text-[11px] leading-5 text-slate-500">题目：{getTracePrompt(log.input_context)}</p>
                          <div className="mt-2.5 flex items-center gap-2 text-[10px] text-slate-400">
                            <span className="rounded-md bg-slate-100 px-1.5 py-1">耗时 {formatTraceLatency(log.latency_ms)}</span>
                            <span className="rounded-md bg-slate-100 px-1.5 py-1">AI 模型 {log.model}</span>
                            <ChevronDown className={`ml-auto h-3.5 w-3.5 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                          </div>
                        </button>
                        {isExpanded && (
                          <div className="space-y-3 border-t border-indigo-100 px-3.5 pb-3.5 pt-3 text-[11px]">
                            <div>
                              <p className="mb-1 font-bold text-slate-600">本次处理的题目</p>
                              <p className="rounded-lg bg-white/80 p-2.5 leading-5 text-slate-600">{getTracePrompt(log.input_context)}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-slate-500">
                              <div className="rounded-lg bg-white/80 p-2"><span className="text-slate-400">AI 参考量</span><br /><b className="text-slate-700">{log.prompt_tokens.toLocaleString()} tokens</b></div>
                              <div className="rounded-lg bg-white/80 p-2"><span className="text-slate-400">AI 生成量</span><br /><b className="text-slate-700">{log.completion_tokens.toLocaleString()} tokens</b></div>
                            </div>
                            <details className="group rounded-lg border border-slate-200 bg-white/70 p-2">
                              <summary className="cursor-pointer list-none font-semibold text-indigo-600 group-open:mb-2">查看原始审计数据</summary>
                              <div className="space-y-2 border-t border-slate-100 pt-2 font-mono text-[10px] leading-4 text-slate-500">
                                <p className="break-all">代理：{log.agent_name} · 记录 ID：{log.id}</p>
                                <div>
                                  <p className="mb-1 font-sans font-semibold text-slate-400">输入内容</p>
                                  <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words">{log.input_context || "没有记录输入内容"}</pre>
                                </div>
                                <div>
                                  <p className="mb-1 font-sans font-semibold text-slate-400">AI 输出</p>
                                  <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words">{log.output_content || "没有记录模型输出"}</pre>
                                </div>
                              </div>
                            </details>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 📤 导入/上传学生答卷 Modal 弹窗 */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl p-6 w-full max-w-5xl shadow-2xl border border-slate-100 space-y-4 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                  <UploadCloud className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">导入 / 上传学生答卷</h3>
                  <p className="text-xs text-slate-400">
                    绑定当前试卷：<span className="font-semibold text-slate-700">{selectedExam?.title || "未选择试卷"}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="关闭学生答卷导入窗口"
                onClick={() => {
                  setShowUploadModal(false);
                  resetVisionUpload();
                }}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            {/* Student Info: Name & Class */}
            <div className="grid gap-3 grid-cols-1 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1 flex items-center gap-1">
                  <School className="w-3.5 h-3.5 text-indigo-600" />
                  {"默认班级（可选）"}
                </label>
                <input
                  type="text"
                  value={uploadClassName}
                  onChange={(e) => setUploadClassName(e.target.value)}
                  placeholder={"视觉分析无法确认时可统一补充"}
                  
                  className="w-full text-xs p-2.5 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-medium"
                />
              </div>
            </div>

            {/* Mode Switch Tabs inside Modal */}
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button
                type="button"

                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  "bg-white text-blue-700 shadow-sm"
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>扫描答卷 / 手写答卷（图片）</span>
              </button>

            </div>

            {
              <div className="space-y-4">
                {previewItems.length === 0 ? (
                  <>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        addStudentFiles(Array.from(event.dataTransfer.files));
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label="批量添加学生答卷 图片"
                      className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        uploadItems.length > 0
                          ? "border-blue-500 bg-blue-50/50"
                          : "border-slate-300 hover:border-blue-400 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".jpg,.jpeg,.png,.gif,.webp"
                        className="hidden"
                        onChange={(event) => {
                          addStudentFiles(Array.from(event.target.files || []));
                          event.target.value = "";
                        }}
                      />
                      <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mx-auto mb-2">
                        <UploadCloud className="w-5 h-5" />
                      </div>
                      <p className="text-xs font-bold text-slate-700">
                        {uploadItems.length > 0 ? `已添加 ${uploadItems.length} 个答卷文件，点击可继续添加` : "一次选择或拖拽多个学生答卷"}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">Pi Agent 将直接查看原始图片；同一学生的多页可在结果中填写相同身份后合并</p>
                    </div>
                    {uploadItems.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2">
                          <p className="text-[11px] font-medium text-blue-800">如果同一批照片方向一致，可批量旋转后再逐张确认。</p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setUploadItems((current) => current.map((item) => {
                                  if (!item.file.type.startsWith("image/")) return item;
                                  const rotation = rotateImage(item.rotation, "left");
                                  return { ...item, rotation, splitPages: shouldSuggestPageSplit(item, rotation) };
                                }));
                                setOrientationConfirmed(false);
                              }}
                              className="rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                            >
                              全部左转
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setUploadItems((current) => current.map((item) => {
                                  if (!item.file.type.startsWith("image/")) return item;
                                  const rotation = rotateImage(item.rotation, "right");
                                  return { ...item, rotation, splitPages: shouldSuggestPageSplit(item, rotation) };
                                }));
                                setOrientationConfirmed(false);
                              }}
                              className="rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                            >
                              全部右转
                            </button>
                          </div>
                        </div>
                        <div className="grid max-h-[26rem] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                          {uploadItems.map((item) => (
                            <AnswerSheetPreviewCard
                              key={item.key}
                              item={item}
                              onRotate={(direction) => {
                                setUploadItems((current) => current.map((row) => {
                                  if (row.key !== item.key) return row;
                                  const rotation = rotateImage(row.rotation, direction);
                                  return { ...row, rotation, splitPages: shouldSuggestPageSplit(row, rotation) };
                                }));
                                setOrientationConfirmed(false);
                              }}
                              onSplitChange={(splitPages) => {
                                setUploadItems((current) => current.map((row) => row.key === item.key ? { ...row, splitPages } : row));
                                setOrientationConfirmed(false);
                              }}
                              onDimensions={(width, height) => {
                                setUploadItems((current) => current.map((row) => {
                                  if (row.key !== item.key || (row.width === width && row.height === height)) return row;
                                  const updated = { ...row, width, height };
                                  const portraitLandscapeHint = height / Math.max(width, 1) >= 1.25
                                    && height / Math.max(width, 1) <= 2.4;
                                  return {
                                    ...updated,
                                    orientationHint: portraitLandscapeHint ? "图片较窄，疑似横向试卷被竖拍，建议先旋转 90°/270°" : undefined,
                                    splitPages: shouldSuggestPageSplit(updated),
                                  };
                                }));
                              }}
                              onRemove={() => {
                                setUploadItems((current) => current.filter((row) => row.key !== item.key));
                                setOrientationConfirmed(false);
                              }}
                            />
                          ))}
                        </div>
                        {uploadItems.some((item) => item.file.type.startsWith("image/")) && (
                          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-900">
                            <input
                              type="checkbox"
                              checked={orientationConfirmed}
                              onChange={(event) => setOrientationConfirmed(event.target.checked)}
                              className="mt-0.5 rounded border-amber-300 text-blue-600"
                            />
                            <span>我已确认上传的是对应学生答卷原图。确认后系统才会开始视觉分析。</span>
                          </label>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-slate-800">识别结果确认</p>
                        <p className="text-[11px] text-slate-500">请补全低置信度信息；相同学生身份的多页会合并为一份答卷。</p>
                      </div>
                      <button type="button" onClick={() => resetVisionUpload()} className="text-xs font-semibold text-blue-600 hover:text-blue-700">返回重新选择</button>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full min-w-[850px] text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500">
                          <tr><th className="px-3 py-2">文件</th><th className="px-3 py-2">学生姓名</th><th className="px-3 py-2">班级</th><th className="px-3 py-2">学号/考号</th><th className="px-3 py-2">题目匹配</th><th className="px-3 py-2">状态</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previewItems.map((item) => (
                            <tr key={item.id} className={item.warnings.length > 0 || item.duplicate ? "bg-amber-50/40" : "bg-white"}>
                              <td className="max-w-44 px-3 py-2">
                                <p className="truncate font-medium text-slate-700" title={item.originalName}>{item.originalName}</p>
                                <p className="text-[10px] text-slate-400">身份证据置信度：{Math.round(item.identityConfidence * 100)}%</p>
                                <p className="text-[10px] font-medium text-blue-600">原图答案证据：{item.answerCount}/{item.totalQuestionCount}</p>
                              </td>
                              <td className="px-3 py-2"><input aria-label={`${item.originalName} 学生姓名`} value={item.studentName} onChange={(event) => setPreviewItems((current) => current.map((row) => row.id === item.id ? { ...row, studentName: event.target.value } : row))} className="w-28 rounded-lg border border-slate-200 p-2" placeholder="必填" /></td>
                              <td className="px-3 py-2"><input aria-label={`${item.originalName} 班级`} value={item.className} onChange={(event) => setPreviewItems((current) => current.map((row) => row.id === item.id ? { ...row, className: event.target.value } : row))} className="w-32 rounded-lg border border-slate-200 p-2" placeholder="必填" /></td>
                              <td className="px-3 py-2"><input aria-label={`${item.originalName} 学号`} value={item.studentNumber} onChange={(event) => setPreviewItems((current) => current.map((row) => row.id === item.id ? { ...row, studentNumber: event.target.value } : row))} className="w-28 rounded-lg border border-slate-200 p-2" placeholder="可选" /></td>
                              <td className="px-3 py-2">
                                <div className={item.answerCount === item.totalQuestionCount ? "font-bold text-emerald-600" : "font-bold text-amber-600"}>{item.answerCount}/{item.totalQuestionCount}</div>
                                <div className={item.reviewRequired ? "text-[10px] font-semibold text-amber-700" : "text-[10px] text-emerald-600"}>
                                  {item.reviewRequired ? item.reviewReason || "需要复核" : "证据完整"}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                {item.duplicate ? (
                                  <select aria-label={`${item.originalName} 重复处理`} value={item.duplicateAction} onChange={(event) => setPreviewItems((current) => current.map((row) => row.id === item.id ? { ...row, duplicateAction: event.target.value as "SKIP" | "REPLACE" } : row))} className="rounded-lg border border-amber-300 bg-white p-2 text-amber-700">
                                    <option value="SKIP">已存在 · 安全跳过</option>
                                    <option value="REPLACE">覆盖并重新批改</option>
                                  </select>
                                ) : item.warnings.length > 0 ? <span className="text-amber-700" title={item.warnings.join("；")}>需要确认</span> : <span className="font-semibold text-emerald-600">可导入</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {uploadStep && (
                  <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping"></span>
                    <span>{uploadStep}</span>
                  </div>
                )}

                {uploadError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-600 flex-shrink-0 mt-0.5" />
                    <div className="break-all">{uploadError}</div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => { setShowUploadModal(false); resetVisionUpload(); }}
                    className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    onClick={previewItems.length > 0 ? handleConfirmBatch : handlePreviewFiles}
                    disabled={(previewItems.length === 0 && !canStartVision) || isUploading}
                    className={`px-5 py-2 text-xs font-bold text-white rounded-xl transition flex items-center gap-1.5 cursor-pointer ${
                      ((previewItems.length > 0 || canStartVision) && !isUploading)
                        ? "bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/30"
                        : "bg-slate-300 cursor-not-allowed"
                    }`}
                  >
                    {isUploading ? <span>处理中...</span> : <span>{previewItems.length > 0 ? "确认并批量批改" : `方向确认并识别 ${uploadItems.length} 份答卷`}</span>}
                  </button>
                </div>
              </div>
            }

          </div>
        </div>
      )}
    </div>
  );
};
