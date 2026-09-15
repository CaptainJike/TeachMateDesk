import React, { useState, useMemo } from "react";
import {
  FolderKanban,
  Search,
  Filter,
  Plus,
  FileText,
  CheckCircle2,
  AlertCircle,
  Lock,
  Calendar,
  Layers,
  ArrowRight,
  Trash2,
  Sparkles,
  BarChart3,
  BookOpen,
  GraduationCap,
  Info,
  Clock,
  ArrowUp,
  ArrowDown,
  RefreshCw,
} from "lucide-react";
import type { ExamPaper, ScoreSummary } from "../types.js";

interface ExamManagementTabProps {
  exams: ExamPaper[];
  selectedExam: ExamPaper | null;
  onSelectExam: (exam: ExamPaper) => void;
  onNavigateToTab: (tabId: string, exam?: ExamPaper) => void;
  onRefreshExams: () => void;
}

type SchoolStage = "PRIMARY" | "MIDDLE" | "HIGH";

interface GradeOption {
  value: string;
  semesterLabel: string;
}

const GRADE_OPTIONS: Record<SchoolStage, GradeOption[]> = {
  PRIMARY: [
    { value: "一年级", semesterLabel: "一年级" },
    { value: "二年级", semesterLabel: "二年级" },
    { value: "三年级", semesterLabel: "三年级" },
    { value: "四年级", semesterLabel: "四年级" },
    { value: "五年级", semesterLabel: "五年级" },
    { value: "六年级", semesterLabel: "六年级" },
  ],
  MIDDLE: [
    { value: "初一", semesterLabel: "七年级" },
    { value: "初二", semesterLabel: "八年级" },
    { value: "初三", semesterLabel: "九年级" },
  ],
  HIGH: [
    { value: "高一", semesterLabel: "高一" },
    { value: "高二", semesterLabel: "高二" },
    { value: "高三", semesterLabel: "高三" },
  ],
};

const UNIFIED_TEXTBOOK_SUBJECTS = new Set(["chinese", "history", "politics"]);

export const ExamManagementTab: React.FC<ExamManagementTabProps> = ({
  exams,
  selectedExam,
  onSelectExam,
  onNavigateToTab,
  onRefreshExams,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterSubject, setFilterSubject] = useState("ALL");
  const [filterStage, setFilterStage] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [hoveredExamId, setHoveredExamId] = useState<string | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  // Modal States
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [modalTab, setModalTab] = useState<"vision" | "text">("vision");
  const [modalVisionFiles, setModalVisionFiles] = useState<File[]>([]);
  const [modalSubject, setModalSubject] = useState("chinese");
  const [modalStage, setModalStage] = useState<SchoolStage>("MIDDLE");
  const [modalGrade, setModalGrade] = useState("初二");
  const [modalTextbook, setModalTextbook] = useState("国家统编教材");
  const [modalPublisher, setModalPublisher] = useState("人民教育出版社");
  const [modalEditionYear, setModalEditionYear] = useState("");
  const [modalSemester, setModalSemester] = useState("八年级下册");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadText, setUploadText] = useState("");
  const [expectedQuestionCount, setExpectedQuestionCount] = useState("");
  const [expectedTotalScore, setExpectedTotalScore] = useState("100");
  const [isParsing, setIsParsing] = useState(false);
  const [modalVisionStep, setModalVisionStep] = useState("");
  const [modalVisionError, setModalVisionError] = useState("");
  const modalFileInputRef = React.useRef<HTMLInputElement>(null);

  // 导入完成后的自动配分结果提示（方案 29）
  const [scoreNotice, setScoreNotice] = useState<{ exam: ExamPaper } | null>(null);
  const [reassigningExamId, setReassigningExamId] = useState<string | null>(null);

  const updateSemesterForGrade = (grade: GradeOption, currentSemester: string) => {
    const volume = currentSemester.endsWith("下册") ? "下册" : "上册";
    setModalSemester(`${grade.semesterLabel}${volume}`);
  };

  const handleStageChange = (stage: SchoolStage) => {
    const firstGrade = GRADE_OPTIONS[stage][0];
    setModalStage(stage);
    setModalGrade(firstGrade.value);
    updateSemesterForGrade(firstGrade, modalSemester);
  };

  const handleGradeChange = (gradeValue: string) => {
    const grade = GRADE_OPTIONS[modalStage].find((option) => option.value === gradeValue);
    if (!grade) return;
    setModalGrade(grade.value);
    updateSemesterForGrade(grade, modalSemester);
  };

  const handleSubjectChange = (subject: string) => {
    setModalSubject(subject);
    setModalTextbook(UNIFIED_TEXTBOOK_SUBJECTS.has(subject) ? "国家统编教材" : "人教版");
    setModalPublisher("人民教育出版社");
  };

  const addExamFiles = (files: File[]) => {
    setModalVisionFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const additions = files.filter((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return [...current, ...additions].slice(0, 50);
    });
  };

  const moveExamFile = (index: number, direction: -1 | 1) => {
    setModalVisionFiles((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  // 处理试卷图片上传
  const handleModalVisionUpload = async () => {
    if (modalVisionFiles.length === 0) return;
    setIsParsing(true);
    setModalVisionError("");
    setModalVisionStep("正在上传文件至本地文件服务器...");

    try {
      const formData = new FormData();
      modalVisionFiles.forEach((file) => formData.append("files", file));
      formData.append("title", uploadTitle.trim());
      formData.append("subject", modalSubject);
      formData.append("school_stage", modalStage);
      formData.append("grade", modalGrade);
      formData.append("textbook_version", modalTextbook.trim());
      formData.append("publisher", modalPublisher.trim());
      formData.append("edition_year", modalEditionYear.trim());
      formData.append("semester", modalSemester);
      formData.append("expected_question_count", expectedQuestionCount.trim());
      formData.append("total_score", expectedTotalScore.trim());
      formData.append("expected_total_score", expectedTotalScore.trim());

      setModalVisionStep(`Pi Agent 正在按页面顺序分析 ${modalVisionFiles.length} 个文件，并合并为一套试卷...`);
      const res = await fetch("/api/exams/import", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "视觉分析与试卷创建失败");
      }

      const data = await res.json();
      setModalVisionStep("");
      setShowUploadModal(false);
      setModalVisionFiles([]);
      setExpectedQuestionCount("");
      setExpectedTotalScore("100");
      onRefreshExams();
      if (data.exam) {
        onSelectExam(data.exam);
        setScoreNotice({ exam: data.exam });
      }
    } catch (err: any) {
      setModalVisionStep("");
      setModalVisionError(err.message || "Pi Vision Agent 识别与试卷创建失败");
    } finally {
      setIsParsing(false);
    }
  };

  // 处理文本直接解析
  const handleModalTextUpload = async () => {
    if (!uploadText.trim()) return;
    setIsParsing(true);
    setModalVisionError("");
    setModalVisionStep("大模型 Agent 正在解析结构化题目并生成分步采分细则...");

    try {
      const res = await fetch("/api/exams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: uploadTitle || "新建文本导入试卷",
          rawText: uploadText,
          subject: modalSubject,
          school_stage: modalStage,
          grade: modalGrade,
          textbook_version: modalTextbook,
          publisher: modalPublisher,
          edition_year: modalEditionYear,
          semester: modalSemester,
          totalScore: Number(expectedTotalScore) > 0 ? Number(expectedTotalScore) : undefined,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "试卷创建失败");
      }

      const exam = await res.json();
      setModalVisionStep("");
      setShowUploadModal(false);
      setUploadText("");
      setUploadTitle("");
      setExpectedTotalScore("100");
      onRefreshExams();
      onSelectExam(exam);
      setScoreNotice({ exam });
    } catch (err: any) {
      setModalVisionStep("");
      setModalVisionError(err.message || "试卷解析创建异常");
    } finally {
      setIsParsing(false);
    }
  };

  const importFeedback = (
    <>
      {modalVisionStep && (
        <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping"></span>
          <span>{modalVisionStep}</span>
        </div>
      )}

      {modalVisionError && (
        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 text-rose-600 flex-shrink-0 mt-0.5" />
          <div className="break-all">{modalVisionError}</div>
        </div>
      )}
    </>
  );

  // 学科中文与色彩映射
  const subjectMap: Record<string, { label: string; bg: string; text: string; border: string }> = {
    chinese: { label: "语文", bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
    math: { label: "数学", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
    english: { label: "英语", bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
    physics: { label: "物理", bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
    chemistry: { label: "化学", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
    biology: { label: "生物", bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200" },
    history: { label: "历史", bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
    geography: { label: "地理", bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-200" },
    politics: { label: "道法", bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
  };

  // 学段映射
  const stageMap: Record<string, { label: string; bg: string }> = {
    PRIMARY: { label: "小学", bg: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
    MIDDLE: { label: "初中", bg: "bg-blue-50 text-blue-700 border border-blue-200" },
    HIGH: { label: "高中", bg: "bg-purple-50 text-purple-700 border border-purple-200" },
  };

  // 题型类型统计映射
  const getQuestionTypeStats = (exam: ExamPaper) => {
    const stats: Record<string, { count: number; totalScore: number }> = {
      FILL_BLANK: { count: 0, totalScore: 0 },
      SINGLE_CHOICE: { count: 0, totalScore: 0 },
      MULTI_CHOICE: { count: 0, totalScore: 0 },
      JUDGE: { count: 0, totalScore: 0 },
      SUBJECTIVE_SHORT: { count: 0, totalScore: 0 },
      ESSAY: { count: 0, totalScore: 0 },
    };

    if (!exam.questions || exam.questions.length === 0) return [];

    exam.questions.forEach((q) => {
      const typeKey = (q.q_type || "SUBJECTIVE_SHORT").toUpperCase();
      if (!stats[typeKey]) {
        stats[typeKey] = { count: 0, totalScore: 0 };
      }
      stats[typeKey].count += 1;
      stats[typeKey].totalScore += q.score_value || 0;
    });

    const typeLabels: Record<string, string> = {
      FILL_BLANK: "填空题",
      SINGLE_CHOICE: "单选题",
      MULTI_CHOICE: "多选题",
      JUDGE: "判断题",
      SUBJECTIVE_SHORT: "简答题",
      ESSAY: "作文/论述",
    };

    return Object.entries(stats)
      .filter(([_, v]) => v.count > 0)
      .map(([k, v]) => ({
        typeKey: k,
        label: typeLabels[k] || k,
        count: v.count,
        totalScore: v.totalScore,
      }));
  };

  // 过滤试卷
  const filteredExams = useMemo(() => {
    return exams.filter((exam) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = exam.title.toLowerCase().includes(q);
        const matchGrade = (exam.grade || "").toLowerCase().includes(q);
        if (!matchTitle && !matchGrade) return false;
      }
      if (filterSubject !== "ALL" && exam.subject !== filterSubject) {
        return false;
      }
      if (filterStage !== "ALL" && exam.school_stage !== filterStage) {
        return false;
      }
      if (filterStatus !== "ALL" && exam.status !== filterStatus) {
        return false;
      }
      return true;
    });
  }, [exams, searchQuery, filterSubject, filterStage, filterStatus]);

  // 格式化时间
  const formatDateTime = (isoStr?: string) => {
    if (!isoStr) return "--";
    try {
      const date = new Date(isoStr);
      return date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoStr;
    }
  };

  // 删除试卷
  const handleDeleteExam = async (examId: string, examTitle: string) => {
    if (!window.confirm(`确认删除试卷【${examTitle}】吗？删除后关联的答卷数据将一并清理。`)) {
      return;
    }
    setIsDeletingId(examId);
    try {
      const res = await fetch(`/api/exams/${examId}`, { method: "DELETE" });
      if (res.ok) {
        onRefreshExams();
      } else {
        alert("删除试卷失败");
      }
    } catch (e) {
      console.error(e);
      alert("删除试卷发生网络异常");
    } finally {
      setIsDeletingId(null);
    }
  };

  // 重新自动配分（方案 25 / 27）；mode=full 表示仅保留人工分值
  const handleReassignScore = async (exam: ExamPaper, mode: "keep-manual" | "full" = "keep-manual") => {
    setReassigningExamId(exam.id);
    try {
      const res = await fetch(`/api/exams/${exam.id}/reassign-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          totalScore: exam.score_summary?.configuredTotalScore || exam.total_score || 100,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "重新自动配分失败");
      }
      const updated: ExamPaper = await res.json();
      onRefreshExams();
      if (selectedExam?.id === updated.id) onSelectExam(updated);
      setScoreNotice({ exam: updated });
    } catch (e: any) {
      alert(e.message || "重新自动配分发生异常");
    } finally {
      setReassigningExamId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* 导入后的自动配分结果提示（方案 29） */}
      {scoreNotice && (
        <div className="bg-white rounded-2xl p-4 border border-emerald-200 shadow-sm space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-900">
                  {scoreNotice.exam.score_summary?.conflict
                    ? "试卷已导入：原卷分值合计超过设置总分"
                    : "已自动完成试卷配分"}
                  <span className="ml-2 text-xs font-medium text-slate-500">{scoreNotice.exam.title}</span>
                </p>
                {scoreNotice.exam.score_summary ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                    <span>试卷总分：<b className="text-slate-900">{scoreNotice.exam.score_summary.totalScore} 分</b></span>
                    <span>识别原有分值：<b className="text-slate-900">{scoreNotice.exam.score_summary.fixedScore} 分</b></span>
                    <span>自动分配：<b className="text-slate-900">{scoreNotice.exam.score_summary.autoScore} 分</b></span>
                    <span>自动配分题目：<b className="text-slate-900">{scoreNotice.exam.score_summary.autoQuestionCount} 道</b></span>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">本题为文本导入，未生成配分摘要。</p>
                )}
                {(scoreNotice.exam.score_summary?.warnings?.length || 0) > 0 && (
                  <ul className="space-y-0.5 text-[11px] text-amber-700">
                    {scoreNotice.exam.score_summary?.warnings.map((warning, index) => (
                      <li key={index} className="flex items-start gap-1">
                        <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span>{warning}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {scoreNotice.exam.score_summary?.conflict && (
                <button
                  onClick={() => handleReassignScore(scoreNotice.exam, "full")}
                  disabled={reassigningExamId === scoreNotice.exam.id}
                  className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition disabled:bg-slate-300"
                >
                  按配置总分重新自动配分
                </button>
              )}
              <button
                onClick={() => setScoreNotice(null)}
                aria-label="关闭配分提示"
                className="w-6 h-6 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Banner & Header */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-extrabold text-slate-900 flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
              <FolderKanban className="w-5 h-5" />
            </div>
            试卷库与题库中心
          </h2>
          <p className="text-xs text-slate-500">
            全生命周期管理已录入的标准试卷，支持查看学科/学段、解析进度、题型分布及一键调起智能批改与学情诊断
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-600/20 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>新建 / 图片导入试卷</span>
          </button>
        </div>
      </div>

      {/* KPI Overview Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>总录入试卷数</span>
            <FileText className="w-4 h-4 text-blue-600" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {exams.length} <span className="text-xs font-normal text-slate-400">套</span>
          </p>
          <span className="text-[11px] text-blue-600 font-medium">涵盖多学科全学段</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>已审核锁定标答</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {exams.filter((x) => x.status === "AUDITED").length}{" "}
            <span className="text-xs font-normal text-slate-400">套</span>
          </p>
          <span className="text-[11px] text-emerald-600 font-medium">Ready for Grading</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>待审校试卷</span>
            <AlertCircle className="w-4 h-4 text-amber-600" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {exams.filter((x) => x.status !== "AUDITED").length}{" "}
            <span className="text-xs font-normal text-slate-400">套</span>
          </p>
          <span className="text-[11px] text-amber-600 font-medium">待教师确认采分量规</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider">
            <span>解析题目总条目</span>
            <Layers className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900">
            {exams.reduce((acc, x) => acc + (x.questions?.length || 0), 0)}{" "}
            <span className="text-xs font-normal text-slate-400">道</span>
          </p>
          <span className="text-[11px] text-indigo-600 font-medium">自动拆解细粒度采分点</span>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索试卷标题、年级..."
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Filter className="w-3.5 h-3.5" />
            <span>筛选：</span>
          </div>

          {/* 学科筛选 */}
          <select
            value={filterSubject}
            onChange={(e) => setFilterSubject(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="ALL">全部学科</option>
            <option value="chinese">语文</option>
            <option value="math">数学</option>
            <option value="english">英语</option>
            <option value="physics">物理</option>
            <option value="chemistry">化学</option>
            <option value="biology">生物</option>
            <option value="history">历史</option>
            <option value="geography">地理</option>
            <option value="politics">道法</option>
          </select>

          {/* 学段筛选 */}
          <select
            value={filterStage}
            onChange={(e) => setFilterStage(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="ALL">全部学段</option>
            <option value="PRIMARY">小学</option>
            <option value="MIDDLE">初中</option>
            <option value="HIGH">高中</option>
          </select>

          {/* 状态筛选 */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="ALL">全部状态</option>
            <option value="AUDITED">已审核锁定</option>
            <option value="PENDING_AUDIT">待教师审核</option>
          </select>
        </div>
      </div>

      {/* Exam Table List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        {filteredExams.length === 0 ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <FileText className="w-12 h-12 mx-auto text-slate-300 stroke-1" />
            <p className="text-sm font-medium">没有匹配的试卷记录</p>
            <button
              onClick={() => setShowUploadModal(true)}
              className="text-xs text-blue-600 hover:text-blue-700 font-bold inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> 立即上传新试卷
            </button>
          </div>
        ) : (
          <div className="overflow-visible">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 text-slate-500 font-bold uppercase tracking-wider border-b border-slate-200 rounded-t-2xl">
                <tr>
                  <th className="py-3.5 px-4 rounded-tl-2xl">学科</th>
                  <th className="py-3.5 px-4">学段</th>
                  <th className="py-3.5 px-4">年级</th>
                  <th className="py-3.5 px-4 min-w-[240px]">试卷名称</th>
                  <th className="py-3.5 px-4">上传时间</th>
                  <th className="py-3.5 px-4">试卷状态</th>
                  <th className="py-3.5 px-4">试卷总分</th>
                  <th className="py-3.5 px-4">试卷总题数</th>
                  <th className="py-3.5 px-4 text-right rounded-tr-2xl">快捷操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredExams.map((exam) => {
                  const subjectMeta = subjectMap[exam.subject.toLowerCase()] || {
                    label: exam.subject,
                    bg: "bg-slate-50",
                    text: "text-slate-700",
                    border: "border-slate-200",
                  };
                  const stageMeta = stageMap[exam.school_stage] || {
                    label: exam.school_stage,
                    bg: "bg-slate-100 text-slate-700 border border-slate-200",
                  };
                  const isAudited = exam.status === "AUDITED";
                  const isParsed = exam.questions && exam.questions.length > 0;
                  const typeStats = getQuestionTypeStats(exam);
                  const isCurrentSelected = selectedExam?.id === exam.id;

                  return (
                    <tr
                      key={exam.id}
                      className={`hover:bg-blue-50/40 transition-colors ${
                        isCurrentSelected ? "bg-blue-50/30" : ""
                      }`}
                    >
                      {/* 学科 */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold ${subjectMeta.bg} ${subjectMeta.text} border ${subjectMeta.border}`}
                        >
                          {subjectMeta.label}
                        </span>
                      </td>

                      {/* 学段 */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${stageMeta.bg}`}
                        >
                          {stageMeta.label}
                        </span>
                      </td>

                      {/* 年级 */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span className="font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                          {exam.grade || "--"}
                        </span>
                      </td>

                      {/* 试卷名称 */}
                      <td className="py-4 px-4">
                        <div className="flex flex-col gap-1 max-w-md">
                          <span className="font-bold text-slate-900 text-sm leading-snug line-clamp-1 hover:text-blue-600 transition cursor-pointer"
                            onClick={() => {
                              onSelectExam(exam);
                              onNavigateToTab("review", exam);
                            }}
                          >
                            {exam.title}
                          </span>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400">
                            {exam.textbook_version && (
                              <span>{exam.textbook_version}</span>
                            )}
                            {exam.publisher && (
                              <>
                                <span>•</span>
                                <span>{exam.publisher}</span>
                              </>
                            )}
                            {exam.edition_year && (
                              <>
                                <span>•</span>
                                <span>{exam.edition_year}</span>
                              </>
                            )}
                            {exam.semester && (
                              <>
                                <span>•</span>
                                <span>{exam.semester}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* 上传时间 */}
                      <td className="py-4 px-4 whitespace-nowrap text-slate-500 font-medium">
                        <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          {formatDateTime(exam.created_at)}
                        </span>
                      </td>

                      {/* 试卷状态 */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        {isAudited ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            已审核锁定
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                            <Clock className="w-3.5 h-3.5" />
                            待教师审核
                          </span>
                        )}
                      </td>

                      {/* 试卷总分 */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        {isParsed ? (
                          <span className="font-extrabold text-sm text-blue-700 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-200">
                            {exam.total_score || 0} 分
                          </span>
                        ) : (
                          <span className="text-slate-400 font-medium">--</span>
                        )}
                      </td>

                      {/* 试卷总题数 (带 Hover Tooltip 题型分布统计) */}
                      <td className="py-4 px-4 whitespace-nowrap relative">
                        {isParsed ? (
                          <div
                            className="inline-block relative group"
                            onMouseEnter={() => setHoveredExamId(exam.id)}
                            onMouseLeave={() => setHoveredExamId(null)}
                          >
                            <span className="inline-flex items-center gap-1 font-bold text-slate-800 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 px-2.5 py-1 rounded-lg border border-slate-200 transition cursor-help">
                              <BookOpen className="w-3.5 h-3.5 text-slate-500 group-hover:text-blue-600" />
                              <span>{exam.questions.length} 题</span>
                              <Info className="w-3 h-3 text-slate-400 group-hover:text-blue-500" />
                            </span>

                            {/* Hover Tooltip Popover - 向下浮动展示，避免被表格顶部遮挡 */}
                            {hoveredExamId === exam.id && typeStats.length > 0 && (
                              <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-60 bg-slate-900/95 text-white rounded-2xl p-3.5 shadow-2xl border border-slate-700/80 backdrop-blur-md pointer-events-none animate-in fade-in slide-in-from-top-1 duration-150">
                                <div className="text-[11px] font-bold text-slate-200 pb-2 mb-2 border-b border-slate-800 flex items-center justify-between">
                                  <span className="flex items-center gap-1">
                                    <Sparkles className="w-3 h-3 text-blue-400" />
                                    题型分布与分值统计
                                  </span>
                                  <span className="text-blue-400 font-mono font-semibold">共 {exam.questions.length} 题</span>
                                </div>
                                <div className="space-y-1.5 text-xs">
                                  {typeStats.map((st) => (
                                    <div
                                      key={st.typeKey}
                                      className="flex items-center justify-between"
                                    >
                                      <span className="text-slate-300 flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                                        {st.label}
                                      </span>
                                      <span className="font-mono font-bold text-slate-100">
                                        {st.count} 题 · {st.totalScore} 分
                                      </span>
                                    </div>
                                  ))}
                                </div>
                                <div className="mt-2.5 pt-2 border-t border-slate-800 space-y-1.5 text-xs text-slate-400 font-semibold">
                                  {exam.score_summary && (
                                    <>
                                      <div className="flex items-center justify-between">
                                        <span>原卷明确分值</span>
                                        <span className="text-slate-100 font-mono">{exam.score_summary.fixedScore} 分</span>
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span>程序自动分配</span>
                                        <span className="text-slate-100 font-mono">
                                          {exam.score_summary.autoScore} 分 · {exam.score_summary.autoQuestionCount} 题
                                        </span>
                                      </div>
                                    </>
                                  )}
                                  <div className="flex items-center justify-between">
                                    <span>试卷满分</span>
                                    <span className="text-amber-300 font-bold font-mono text-sm">
                                      {exam.total_score} 分
                                    </span>
                                  </div>
                                  {exam.score_summary && exam.total_score !== exam.score_summary.configuredTotalScore && (
                                    <div className="text-[10px] text-amber-300/90 font-medium pt-0.5">
                                      配置总分 {exam.score_summary.configuredTotalScore} 分，已按实际分值计算
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 font-medium">--</span>
                        )}
                      </td>

                      {/* 快捷操作栏 */}
                      <td className="py-4 px-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              onSelectExam(exam);
                              onNavigateToTab("review", exam);
                            }}
                            title="审校标答与分步采分量规"
                            className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs rounded-lg transition flex items-center gap-1"
                          >
                            <span>审校量规</span>
                          </button>

                          <button
                            onClick={() => {
                              onSelectExam(exam);
                              onNavigateToTab("batch", exam);
                            }}
                            title="前往批量智能批改"
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition flex items-center gap-1"
                          >
                            <span>去批改</span>
                          </button>

                          <button
                            onClick={() => {
                              onSelectExam(exam);
                              onNavigateToTab("analytics", exam);
                            }}
                            title="查看班级学情全景"
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition"
                          >
                            <BarChart3 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleReassignScore(exam)}
                            disabled={reassigningExamId === exam.id}
                            title="保留人工与原卷分值，重新按题型权重自动配分"
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg transition disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${reassigningExamId === exam.id ? "animate-spin" : ""}`} />
                          </button>

                          <button
                            onClick={() => handleDeleteExam(exam.id, exam.title)}
                            disabled={isDeletingId === exam.id}
                            title="删除试卷"
                            className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition disabled:opacity-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 新建并导入试卷 Modal 弹窗 */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl p-6 max-w-xl w-full shadow-2xl border border-slate-100 space-y-4 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                  <FolderKanban className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">新建并导入试卷</h3>
                  <p className="text-xs text-slate-400">支持图片直接由 Pi Vision Agent 解析，或粘贴文本</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="关闭试卷导入窗口"
                onClick={() => {
                  setShowUploadModal(false);
                  setModalVisionError("");
                  setModalVisionStep("");
                }}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            {/* Mode Switch Tabs inside Modal */}
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setModalTab("vision")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  modalTab === "vision"
                    ? "bg-white text-blue-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>图片智能分析导入</span>
              </button>
              <button
                type="button"
                onClick={() => setModalTab("text")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  modalTab === "text"
                    ? "bg-white text-blue-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>手动粘贴文本 / Markdown</span>
              </button>
            </div>

            {/* Shared exam metadata for vision and text imports */}
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">学科</label>
                  <select
                    value={modalSubject}
                    onChange={(e) => handleSubjectChange(e.target.value)}
                    className="w-full text-xs rounded-lg border-slate-200 border p-2 bg-white font-medium"
                  >
                    <option value="chinese">语文</option>
                    <option value="math">数学</option>
                    <option value="english">英语</option>
                    <option value="physics">物理</option>
                    <option value="chemistry">化学</option>
                    <option value="biology">生物</option>
                    <option value="history">历史</option>
                    <option value="geography">地理</option>
                    <option value="politics">道法</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">学段</label>
                  <select
                    value={modalStage}
                    onChange={(e) => handleStageChange(e.target.value as SchoolStage)}
                    className="w-full text-xs rounded-lg border-slate-200 border p-2 bg-white font-medium"
                  >
                    <option value="PRIMARY">小学</option>
                    <option value="MIDDLE">初中</option>
                    <option value="HIGH">高中</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">年级</label>
                  <select
                    value={modalGrade}
                    onChange={(e) => handleGradeChange(e.target.value)}
                    className="w-full text-xs rounded-lg border-slate-200 border p-2 bg-white font-medium"
                  >
                    {GRADE_OPTIONS[modalStage].map((grade) => (
                      <option key={grade.value} value={grade.value}>
                        {grade.value}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">教材体系 / 版本</label>
                  <input
                    type="text"
                    value={modalTextbook}
                    onChange={(e) => setModalTextbook(e.target.value)}
                    placeholder="例如：国家统编教材 / 人教版"
                    className="w-full text-xs rounded-lg border-slate-200 border p-2 bg-white font-medium"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">出版社</label>
                  <input
                    type="text"
                    value={modalPublisher}
                    onChange={(e) => setModalPublisher(e.target.value)}
                    placeholder="例如：人民教育出版社"
                    className="w-full text-xs rounded-lg border-slate-200 border p-2 bg-white font-medium"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">版次 / 修订年份</label>
                  <input
                    type="text"
                    value={modalEditionYear}
                    onChange={(e) => setModalEditionYear(e.target.value)}
                    placeholder="例如：2024年修订版"
                    className="w-full text-xs rounded-lg border-slate-200 border p-2 bg-white font-medium"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">册次</label>
                  <input
                    type="text"
                    value={modalSemester}
                    onChange={(e) => setModalSemester(e.target.value)}
                    placeholder="例如：八年级下册"
                    className="w-full text-xs rounded-lg border-slate-200 border p-2 bg-white font-medium"
                  />
                </div>
              </div>
            </div>

            {modalTab === "vision" ? (
              <div className="space-y-4">
                {/* File Dropzone */}
                <div
                  onClick={() => modalFileInputRef.current?.click()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") modalFileInputRef.current?.click();
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    addExamFiles(Array.from(event.dataTransfer.files));
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label="添加同一套试卷的 图片页面"
                  className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    modalVisionFiles.length > 0
                      ? "border-blue-500 bg-blue-50/50"
                      : "border-slate-300 hover:border-blue-400 hover:bg-slate-50"
                  }`}
                >
                  <input
                    ref={modalFileInputRef}
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.webp"
                    className="hidden"
                    onChange={(e) => {
                      addExamFiles(Array.from(e.target.files || []));
                      e.target.value = "";
                    }}
                  />

                  <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mx-auto mb-2">
                    <FileText className="w-5 h-5" />
                  </div>

                  {modalVisionFiles.length > 0 ? (
                    <div>
                      <p className="font-bold text-slate-800 text-xs">已添加 {modalVisionFiles.length} 个文件</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        点击或拖拽可继续添加；下方顺序即试卷页序
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs font-bold text-slate-700">添加同一套试卷的 多张图片</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">可连续拍摄多页；系统会按下方顺序合并为一套试卷</p>
                    </div>
                  )}
                </div>

                {modalVisionFiles.length > 0 && (
                  <div className="space-y-2 max-h-44 overflow-y-auto" aria-label="试卷页面顺序">
                    {modalVisionFiles.map((file, index) => (
                      <div key={`${file.name}:${file.size}:${file.lastModified}`} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[11px] font-bold text-blue-700">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-slate-700">{file.name}</p>
                          <p className="text-[10px] text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                        </div>
                        <button type="button" aria-label={`上移 ${file.name}`} disabled={index === 0} onClick={() => moveExamFile(index, -1)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                        <button type="button" aria-label={`下移 ${file.name}`} disabled={index === modalVisionFiles.length - 1} onClick={() => moveExamFile(index, 1)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                        <button type="button" aria-label={`移除 ${file.name}`} onClick={() => setModalVisionFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-lg p-1 text-rose-500 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-bold text-slate-600">试卷名称（可选）</label>
                    <input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} placeholder="留空则自动识别" className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold text-slate-600">预计题数（可选）</label>
                    <input type="number" min="1" value={expectedQuestionCount} onChange={(event) => setExpectedQuestionCount(event.target.value)} placeholder="如 22" className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold text-slate-600">试卷总分</label>
                    <input type="number" min="1" step="0.5" value={expectedTotalScore} onChange={(event) => setExpectedTotalScore(event.target.value)} placeholder="默认 100" className="w-full rounded-lg border border-slate-200 bg-white p-2 text-xs" />
                  </div>
                </div>

                <p className="flex items-start gap-1.5 text-[11px] text-slate-500 leading-relaxed">
                  <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                  <span>
                    原卷未标注分值时会由系统按题型权重自动配分，并保证题目分值合计严格等于试卷总分；留空默认按 100 分配置。原卷已明确标注的分值不会被覆盖。
                  </span>
                </p>

                {importFeedback}

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => setShowUploadModal(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleModalVisionUpload}
                    disabled={modalVisionFiles.length === 0 || isParsing}
                    className={`px-5 py-2 text-xs font-bold text-white rounded-xl transition flex items-center gap-1.5 ${
                      modalVisionFiles.length > 0 && !isParsing
                        ? "bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/30"
                        : "bg-slate-300 cursor-not-allowed"
                    }`}
                  >
                    {isParsing ? <span>正在解析中...</span> : <span>合并并创建一套试卷</span>}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    试卷名称
                  </label>
                  <input
                    type="text"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    placeholder="例如：统编版八年级语文期末模拟试卷 (A卷)"
                    className="w-full text-xs p-2.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    试卷与参考答案内容 (Markdown / 纯文本)
                  </label>
                  <textarea
                    value={uploadText}
                    onChange={(e) => setUploadText(e.target.value)}
                    placeholder="粘贴试卷大题内容，例如：&#10;1. 下列加点字读音正确的是 ( ) (3分)&#10;A. 炽热(chì)  B. 畸形(jī)&#10;&#10;2. 简析《赤壁》后两句的主旨情感。(4分)&#10;参考答案：借古讽今，抒发作者怀才不遇之情。"
                    rows={8}
                    className="w-full text-xs p-3 font-mono border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                {importFeedback}

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => setShowUploadModal(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleModalTextUpload}
                    disabled={!uploadText.trim() || isParsing}
                    className={`px-5 py-2 text-xs font-bold text-white rounded-xl transition flex items-center gap-1.5 ${
                      uploadText.trim() && !isParsing
                        ? "bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/30"
                        : "bg-slate-300 cursor-not-allowed"
                    }`}
                  >
                    {isParsing ? <span>正在解析中...</span> : <span>确认</span>}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
