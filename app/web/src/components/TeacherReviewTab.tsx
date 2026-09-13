import React, { useState, useEffect, useRef } from "react";
import {
  FileText,
  CheckCircle2,
  Lock,
  Plus,
  Trash2,
  Edit3,
  Save,
  BookOpen,
  Sparkles,
  AlertCircle,
  UploadCloud,
  Loader2,
} from "lucide-react";
import type { ExamPaper, Question, RubricStep } from "../types.js";
import { MathText, normalizeLatexEscapes } from "./MathText.js";
import { formatQuestionLabel } from "../utils/question-label.js";

interface TeacherReviewTabProps {
  exams: ExamPaper[];
  selectedExam: ExamPaper | null;
  onSelectExam: (exam: ExamPaper) => void;
  onRefreshExams: () => void;
}

export const TeacherReviewTab: React.FC<TeacherReviewTabProps> = ({
  exams,
  selectedExam,
  onSelectExam,
  onRefreshExams,
}) => {
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState<number>(0);
  const [editingRubric, setEditingRubric] = useState<RubricStep[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [isSavingContent, setIsSavingContent] = useState(false);
  const [contentError, setContentError] = useState("");
  const [editingContent, setEditingContent] = useState({
    stemText: "",
    optionsText: "",
    correctAnswer: "",
    analysis: "",
  });

  const sortedQuestions = React.useMemo(() => {
    return [...(selectedExam?.questions || [])].sort((a, b) => {
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
  }, [selectedExam?.questions]);

  const formatQuestionTitle = (qNum: number, subNum?: string) =>
    formatQuestionLabel(qNum, subNum);

  const getQuestionTypeLabel = (type?: string) => {
    const map: Record<string, { label: string; bg: string; text: string; border: string }> = {
      SINGLE_CHOICE: { label: "单选题", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
      MULTI_CHOICE: { label: "多选题", bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-200" },
      JUDGE: { label: "判断题", bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
      FILL_BLANK: { label: "填空题", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
      SUBJECTIVE_SHORT: { label: "简答题", bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
      ESSAY: { label: "作文/论述", bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
    };
    return map[(type || "").toUpperCase()] || { label: type || "主观题", bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-200" };
  };

  const currentQuestion = sortedQuestions[selectedQuestionIndex] || sortedQuestions[0];

  React.useEffect(() => {
    setSelectedQuestionIndex(0);
  }, [selectedExam?.id]);

  React.useEffect(() => {
    if (currentQuestion && currentQuestion.standard_answer) {
      setEditingRubric(
        JSON.parse(JSON.stringify(currentQuestion.standard_answer.rubric_steps || []))
      );
      setIsEditing(false);
    }
    if (currentQuestion) {
      setEditingContent({
        stemText: normalizeLatexEscapes(currentQuestion.stem_text || ""),
        optionsText: (currentQuestion.options || []).map(normalizeLatexEscapes).join("\n"),
        correctAnswer: normalizeLatexEscapes(currentQuestion.standard_answer?.correct_answer || ""),
        analysis: normalizeLatexEscapes(currentQuestion.standard_answer?.analysis || ""),
      });
      setIsEditingContent(false);
      setContentError("");
    }
  }, [selectedQuestionIndex, currentQuestion]);

  const handleSaveContent = async () => {
    if (!selectedExam || !currentQuestion) return;
    if (!editingContent.stemText.trim()) {
      setContentError("题干内容不能为空");
      return;
    }

    setIsSavingContent(true);
    setContentError("");
    try {
      const response = await fetch(
        `/api/exams/${selectedExam.id}/questions/${currentQuestion.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stemText: editingContent.stemText,
            options: editingContent.optionsText.split("\n"),
            correctAnswer: editingContent.correctAnswer,
            analysis: editingContent.analysis,
          }),
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "保存失败，请稍后重试");
      }
      setIsEditingContent(false);
      onRefreshExams();
    } catch (error) {
      setContentError(error instanceof Error ? error.message : "保存失败，请稍后重试");
    } finally {
      setIsSavingContent(false);
    }
  };

  const handleStepChange = (index: number, field: keyof RubricStep, val: any) => {
    const next = [...editingRubric];
    next[index] = { ...next[index], [field]: val };
    setEditingRubric(next);
  };

  const handleAddStep = () => {
    const nextNo = editingRubric.length + 1;
    setEditingRubric([
      ...editingRubric,
      {
        step_no: nextNo,
        score: 1,
        criteria: "",
        keywords: [],
      },
    ]);
  };

  const handleRemoveStep = (index: number) => {
    const next = editingRubric.filter((_, i) => i !== index);
    // re-index
    next.forEach((s, idx) => {
      s.step_no = idx + 1;
    });
    setEditingRubric(next);
  };

  const handleSaveRubric = async () => {
    if (!selectedExam || !currentQuestion) return;
    setIsSaving(true);
    try {
      const res = await fetch(
        `/api/exams/${selectedExam.id}/questions/${currentQuestion.id}/rubric`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rubricSteps: editingRubric }),
        }
      );
      if (res.ok) {
        setIsEditing(false);
        onRefreshExams();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAuditLock = async () => {
    if (!selectedExam) return;
    try {
      const res = await fetch(`/api/exams/${selectedExam.id}/audit`, {
        method: "POST",
      });
      if (res.ok) {
        onRefreshExams();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const currentRubricSum = editingRubric.reduce((acc, s) => acc + (Number(s.score) || 0), 0);
  const isScoreMatched = currentQuestion ? currentRubricSum === currentQuestion.score_value : true;

  if (!selectedExam) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-500 border border-slate-200">
        暂无试卷，请先在【试卷管理】中导入真实试卷。
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-105px)] flex flex-col overflow-hidden">
      {/* Top Banner & Metadata */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex flex-col gap-3 shrink-0 mb-4">
        {/* Row 1: Exam Switcher & Actions */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 pb-3 border-b border-slate-100">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-lg">
              <FileText className="w-3.5 h-3.5 text-blue-600" />
              选择试卷 ({exams.length} 套):
            </span>
            <select
              value={selectedExam?.id || ""}
              onChange={(e) => {
                const target = exams.find((x) => x.id === e.target.value);
                if (target) {
                  onSelectExam(target);
                  setSelectedQuestionIndex(0);
                }
              }}
              className="px-3.5 py-1.5 bg-blue-50/70 hover:bg-blue-50 border border-blue-200 text-blue-900 text-xs font-bold rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition cursor-pointer shadow-xs max-w-md"
            >
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.title} ({exam.questions?.length || 0} 题 · {exam.total_score || 0} 分 · {exam.status === "AUDITED" ? "已锁定" : "待审核"})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            {selectedExam && selectedExam.status !== "AUDITED" && (
              <button
                onClick={handleAuditLock}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl shadow-sm shadow-emerald-600/30 transition"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>一键确认审核并锁定标答</span>
              </button>
            )}
          </div>
        </div>

        {/* Row 2: Selected Exam Details & Tags */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">
                {selectedExam?.title || "试卷标答与采分细则审核中心"}
              </h2>
              {selectedExam?.status === "AUDITED" ? (
                <span className="flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <Lock className="w-3 h-3" /> 已审核锁定
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                  <AlertCircle className="w-3 h-3" /> 待教师审核
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="bg-slate-100 px-2 py-0.5 rounded font-medium text-slate-700">
                学段：{selectedExam?.school_stage || "初中 (MIDDLE)"}
              </span>
              <span className="bg-slate-100 px-2 py-0.5 rounded font-medium text-slate-700">
                年级：{selectedExam?.grade || "初二"}
              </span>
              <span className="bg-slate-100 px-2 py-0.5 rounded font-medium text-slate-700">
                教材体系：{selectedExam.textbook_version || "未填写"}
              </span>
              <span className="bg-slate-100 px-2 py-0.5 rounded font-medium text-slate-700">
                出版社：{selectedExam.publisher || "未填写"}
              </span>
              {selectedExam.edition_year && (
                <span className="bg-slate-100 px-2 py-0.5 rounded font-medium text-slate-700">
                  版次：{selectedExam.edition_year}
                </span>
              )}
              <span className="bg-slate-100 px-2 py-0.5 rounded font-medium text-slate-700">
                册次：{selectedExam?.semester || "八年级下册"}
              </span>
              <span className="text-slate-400">|</span>
              <span className="font-semibold text-slate-700">总满分：{selectedExam?.total_score || 0} 分</span>
              <span className="font-semibold text-slate-700">共 {selectedExam?.questions?.length || 0} 道题</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Workspace: Left Questions Tree, Right Rubric Editor */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch pb-2">
        {/* Left: Question Navigation List */}
        <div className="lg:col-span-4 bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
            <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-600" />
              题目目录索引 ({selectedExam?.questions.length || 0})
            </h3>
            <span className="text-xs text-slate-400">点击切换题目</span>
          </div>

          <div className="space-y-2 flex-1 overflow-y-auto pr-1.5 mt-3">
            {sortedQuestions.map((q, idx) => {
              const isSelected = (selectedQuestionIndex === idx);
              const typeMeta = getQuestionTypeLabel(q.q_type);
              return (
                <div
                  key={q.id ? `${q.id}_${idx}` : idx}
                  onClick={() => setSelectedQuestionIndex(idx)}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? "border-blue-500 bg-blue-50/60 shadow-sm ring-1 ring-blue-500/20"
                      : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700">
                      {formatQuestionTitle(q.question_num, q.sub_num)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${typeMeta.bg} ${typeMeta.text} ${typeMeta.border}`}>
                        {typeMeta.label}
                      </span>
                      <span className="text-xs font-bold text-slate-700">
                        {q.score_value} 分
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-600 line-clamp-2 leading-relaxed">
                    <MathText>{q.stem_text}</MathText>
                  </p>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      采分步骤：{q.standard_answer?.rubric_steps.length || 0} 步
                    </span>
                    {q.standard_answer?.is_teacher_edited && (
                      <span className="text-emerald-600 font-medium flex items-center gap-0.5">
                        <CheckCircle2 className="w-3 h-3" /> 已人工微调
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Question Detail & Rubric Steps Editor */}
        <div className="lg:col-span-8 h-full overflow-y-auto pr-2 space-y-5">
          {currentQuestion ? (
            <>
              {/* Question Stem & Standard Answer Card */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-base text-slate-900">
                      {formatQuestionTitle(currentQuestion.question_num, currentQuestion.sub_num)} 详情
                    </span>
                    <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-blue-100 text-blue-800">
                      满分 {currentQuestion.score_value} 分
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 font-medium">
                      题型：<span className="font-bold text-slate-800">{getQuestionTypeLabel(currentQuestion.q_type).label}</span>
                    </span>
                    {!isEditingContent && (
                      <button
                        onClick={() => setIsEditingContent(true)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium text-xs rounded-lg border border-blue-200 transition"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        编辑题目与解析
                      </button>
                    )}
                  </div>
                </div>

                {isEditingContent ? (
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1">题干内容</label>
                      <textarea
                        value={editingContent.stemText}
                        onChange={(event) => setEditingContent((current) => ({ ...current, stemText: event.target.value }))}
                        rows={4}
                        className="w-full text-sm p-3 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1">选项（每行一个，无选项可留空）</label>
                      <textarea
                        value={editingContent.optionsText}
                        onChange={(event) => setEditingContent((current) => ({ ...current, optionsText: event.target.value }))}
                        rows={3}
                        className="w-full text-sm p-3 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1">参考答案</label>
                      <textarea
                        value={editingContent.correctAnswer}
                        onChange={(event) => setEditingContent((current) => ({ ...current, correctAnswer: event.target.value }))}
                        rows={2}
                        className="w-full text-sm p-3 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1">解析</label>
                      <textarea
                        value={editingContent.analysis}
                        onChange={(event) => setEditingContent((current) => ({ ...current, analysis: event.target.value }))}
                        rows={5}
                        className="w-full text-sm p-3 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none"
                      />
                    </div>
                    {contentError && (
                      <p className="text-xs text-rose-600 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" /> {contentError}
                      </p>
                    )}
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setIsEditingContent(false)}
                        disabled={isSavingContent}
                        className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        取消
                      </button>
                      <button
                        onClick={handleSaveContent}
                        disabled={isSavingContent}
                        className="flex items-center gap-1 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                      >
                        {isSavingContent ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        {isSavingContent ? "保存中..." : "保存题目与解析"}
                      </button>
                    </div>
                  </div>
                ) : (
                <>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                    题干内容 (Stem)
                  </h4>
                  <p className="text-sm font-medium text-slate-800 leading-relaxed">
                    <MathText>{currentQuestion.stem_text}</MathText>
                  </p>
                  {currentQuestion.options && currentQuestion.options.length > 0 && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {currentQuestion.options.map((opt, idx) => (
                        <div
                          key={idx}
                          className="bg-white p-2 rounded-lg border border-slate-200 text-xs text-slate-700"
                        >
                          <MathText>{opt}</MathText>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-200/60">
                  <h4 className="text-xs font-bold text-blue-700 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" />
                    参考答案与解析 (Reference Answer)
                  </h4>
                  <p className="text-sm text-slate-800 font-medium">
                    <MathText>{currentQuestion.standard_answer?.correct_answer || "无"}</MathText>
                  </p>
                  {currentQuestion.standard_answer?.analysis && (
                    <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                      解析：<MathText>{currentQuestion.standard_answer.analysis}</MathText>
                    </p>
                  )}
                </div>
                </>
                )}
              </div>

              {/* Rubric Steps Editor Card (核心生命线) */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-indigo-600" />
                      分步采分细则列表 (Rubric Steps)
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Rubric Agent 自动生成的细粒度采分要点，教师可在线微调分值与关键词
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {!isEditing ? (
                      <button
                        onClick={() => setIsEditing(true)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs rounded-lg transition"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>在线编辑采分点</span>
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={handleAddStep}
                          className="flex items-center gap-1 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-medium text-xs rounded-lg transition border border-indigo-200"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>增加步骤</span>
                        </button>
                        <button
                          onClick={handleSaveRubric}
                          disabled={!isScoreMatched || isSaving}
                          className={`flex items-center gap-1 px-3.5 py-1.5 font-medium text-xs rounded-lg transition ${
                            isScoreMatched && !isSaving
                              ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-600/30"
                              : "bg-slate-200 text-slate-400 cursor-not-allowed"
                          }`}
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>{isSaving ? "保存中..." : "保存采分细则"}</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Score verification check */}
                <div
                  className={`p-3 rounded-xl flex items-center justify-between text-xs font-medium ${
                    isScoreMatched
                      ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                      : "bg-rose-50 text-rose-800 border border-rose-200"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {isScoreMatched ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-600" />
                    )}
                    步骤分值总和：{currentRubricSum} 分 / 题目满分：{currentQuestion.score_value} 分
                  </span>
                  <span>
                    {isScoreMatched
                      ? "分值校验通过"
                      : `分值不匹配（偏差 ${currentRubricSum - currentQuestion.score_value} 分），请调整`}
                  </span>
                </div>

                {/* Step List */}
                <div className="space-y-3">
                  {editingRubric.map((step, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center">
                            {step.step_no}
                          </span>
                          <span className="font-bold text-sm text-slate-800">
                            步骤 {step.step_no} 采分项
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-slate-500">
                              分值：
                            </span>
                            {isEditing ? (
                              <input
                                type="number"
                                min="0.5"
                                max="50"
                                step="0.5"
                                value={step.score}
                                onChange={(e) =>
                                  handleStepChange(idx, "score", parseFloat(e.target.value) || 0)
                                }
                                className="w-16 px-2 py-1 text-xs font-bold border border-slate-300 rounded bg-white text-center focus:ring-1 focus:ring-blue-500 outline-none"
                              />
                            ) : (
                              <span className="font-extrabold text-sm text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded border border-blue-200">
                                {step.score} 分
                              </span>
                            )}
                          </div>

                          {isEditing && (
                            <button
                              onClick={() => handleRemoveStep(idx)}
                              className="text-slate-400 hover:text-rose-600 transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Criteria */}
                      <div>
                        <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                          采分判定标准 (Criteria)
                        </label>
                        {isEditing ? (
                          <textarea
                            value={step.criteria}
                            onChange={(e) => handleStepChange(idx, "criteria", e.target.value)}
                            className="w-full text-xs p-2.5 border border-slate-300 rounded-lg bg-white focus:ring-1 focus:ring-blue-500 outline-none"
                            rows={2}
                          />
                        ) : (
                          <p className="text-xs text-slate-800 leading-relaxed font-medium">
                            {step.criteria}
                          </p>
                        )}
                      </div>

                      {/* Keywords */}
                      <div>
                        <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                          核心关键词 (Keywords)
                        </label>
                        {isEditing ? (
                          <input
                            type="text"
                            value={step.keywords.join(", ")}
                            onChange={(e) =>
                              handleStepChange(
                                idx,
                                "keywords",
                                e.target.value.split(/[,，]\s*/).filter(Boolean)
                              )
                            }
                            className="w-full text-xs p-2 border border-slate-300 rounded-lg bg-white focus:ring-1 focus:ring-blue-500 outline-none"
                            placeholder="以逗号分隔，如：以小见大, 怀才不遇"
                          />
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {step.keywords.map((kw, kidx) => (
                              <span
                                key={kidx}
                                className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-slate-200/80 text-slate-700"
                              >
                                {kw}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-2xl p-12 text-center text-slate-400 border border-slate-200">
              请从左侧选择题目以查看或编辑采分细则。
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
