import React, { useState } from "react";
import {
  GraduationCap,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Sparkles,
  Quote,
  ArrowRight,
  BookOpen,
  HelpCircle,
} from "lucide-react";
import type { StudentSubmission, ExamPaper } from "../types.js";
import { formatQuestionLabel } from "../utils/question-label.js";

const isObjectiveQuestion = (questionType?: string) =>
  ["SINGLE_CHOICE", "MULTI_CHOICE", "JUDGE"].includes((questionType || "").toUpperCase());

interface StudentReportTabProps {
  selectedExam: ExamPaper | null;
  submissions: StudentSubmission[];
  selectedSubmissionId: string;
  onSelectSubmission: (id: string) => void;
  onGoToRevision: (detailId: string) => void;
}

export const StudentReportTab: React.FC<StudentReportTabProps> = ({
  selectedExam,
  submissions,
  selectedSubmissionId,
  onSelectSubmission,
  onGoToRevision,
}) => {
  const examSubmissions = selectedExam
    ? submissions.filter((s) => s.exam_id === selectedExam.id)
    : submissions;

  const currentSubmission =
    examSubmissions.find((s) => s.id === selectedSubmissionId) || examSubmissions[0];

  const totalMax = selectedExam?.total_score || currentSubmission?.grading_details.reduce((sum, d) => sum + (d.max_score || 0), 0) || 0;
  const scorePercent = currentSubmission && totalMax > 0
    ? Math.round((currentSubmission.total_score / totalMax) * 100)
    : 0;

  if (examSubmissions.length === 0) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-blue-600" />
            学生端：作业批改报告与采分步骤证据树
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            当前试卷：<span className="font-semibold text-blue-700">{selectedExam?.title || "未选择试卷"}</span>
          </p>
        </div>

        <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 shadow-sm space-y-4">
          <div className="w-16 h-16 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
            <BookOpen className="w-8 h-8" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="text-base font-bold text-slate-900">当前试卷暂无学生批改记录</h3>
            <p className="text-xs text-slate-500">
              请切换至【试卷/答卷图片分析】或【批量智能批改】工作台，导入并批改该试卷的学生答卷。
            </p>
          </div>
        </div>
      </div>
    );
  }

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

  return (
    <div className="space-y-6">
      {/* Top Header & Student Selector */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-blue-600" />
            学生端：作业批改报告与采分步骤证据树
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            透明化呈现“AI评分 → 答卷原文证据(Quote) → Rubric 采分点”，让失分原因清清楚楚
          </p>
        </div>

        {/* Student Switcher */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-slate-600">选择学生答卷 ({examSubmissions.length} 份)：</label>
          <select
            value={currentSubmission?.id || ""}
            onChange={(e) => onSelectSubmission(e.target.value)}
            className="text-xs font-bold py-2 px-3 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition cursor-pointer"
          >
            {examSubmissions.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.student_name} · {sub.class_name || "未填写班级"} ({sub.total_score} 分)
              </option>
            ))}
          </select>
        </div>
      </div>

      {currentSubmission ? (
        <>
          {/* Student Overview Card */}
          <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 text-white rounded-2xl p-6 shadow-lg shadow-blue-900/20 grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="space-y-1">
              <span className="text-xs font-medium text-blue-200 uppercase tracking-wider">
                学生姓名 & 班级
              </span>
              <h3 className="text-2xl font-extrabold flex items-center gap-2">
                {currentSubmission.student_name}
                <span className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-white/20 text-blue-100 border border-white/20">
                  {currentSubmission.class_name || "未填写班级"}
                </span>
              </h3>
              <p className="text-xs text-blue-300">
                所属试卷：{selectedExam?.title || "未选择试卷"}
              </p>
            </div>

            <div className="space-y-1 border-t sm:border-t-0 sm:border-l border-white/15 sm:pl-6">
              <span className="text-xs font-medium text-blue-200 uppercase tracking-wider">
                最终总得分
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-amber-300">
                  {currentSubmission.total_score}
                </span>
                <span className="text-xs text-blue-200">/ 满分 {totalMax} 分</span>
              </div>
              <span className="inline-block text-[11px] font-semibold bg-white/20 px-2 py-0.5 rounded-full">
                得分率 {scorePercent}%
              </span>
            </div>

            <div className="space-y-1 border-t sm:border-t-0 sm:border-l border-white/15 sm:pl-6">
              <span className="text-xs font-medium text-blue-200 uppercase tracking-wider">
                批改诊断摘要
              </span>
              <p className="text-xs text-blue-100 leading-relaxed">
                {currentSubmission.total_score === totalMax
                  ? "太棒了！所有客观题与主观题采分点全部精准命中，语言规范凝练。"
                  : "部分主观题采分点存在要点缺失或表达偏差，已为您生成专属启发式订正建议。"}
              </p>
            </div>
          </div>

          {/* Question Breakdown List */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-blue-600" />
                题目逐项采分核验与证据链 ({currentSubmission.grading_details.length} 题)
              </h3>
            </div>

            {currentSubmission.grading_details.map((detail) => {
              const isFull = detail.final_score === detail.max_score;
              const isObjective = isObjectiveQuestion(detail.question_type);
              const hasRevision = !isObjective && detail.revision_logs && detail.revision_logs.length > 0;
              const typeMeta = getQuestionTypeLabel(detail.question_type);

              return (
                <div
                  key={detail.id}
                  className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4 hover:border-slate-300 transition"
                >
                  {/* Question Title & Score Badge */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-sm px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 border border-slate-200">
                        {formatQuestionLabel(detail.question_num, detail.sub_num)}
                      </span>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded border ${typeMeta.bg} ${typeMeta.text} ${typeMeta.border}`}>
                        {typeMeta.label}
                      </span>
                      {detail.error_type && detail.error_type !== "NONE" && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                          {detail.error_type === "KNOWLEDGE_GAP"
                            ? "知识盲区"
                            : detail.error_type === "LOGIC_STEP_MISSING"
                            ? "逻辑跳步"
                            : detail.error_type === "EXPRESSION_BIAS"
                            ? "表达偏差"
                            : "客观错选"}
                        </span>
                      )}
                      {hasRevision && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" /> 已完成二次订正
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <span className="text-lg font-extrabold text-blue-700">
                          {detail.final_score}
                        </span>
                        <span className="text-xs text-slate-400"> / {detail.max_score} 分</span>
                      </div>

                      {!isFull && !isObjective && (
                        <button
                          onClick={() => onGoToRevision(detail.id)}
                          className="flex items-center gap-1 text-xs font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 px-3.5 py-1.5 rounded-lg shadow-sm transition"
                        >
                          <span>在线订正此题</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                      {!isFull && isObjective && (
                        <span className="text-xs font-semibold text-slate-500">
                          客观题已按标准答案判分，无需二次订正
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Stem */}
                  <div className="text-xs font-medium text-slate-700 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
                    <span className="font-bold text-slate-500 mr-1.5">题干：</span>
                    {detail.stem_text}
                  </div>

                  {/* Student Answer & Raw Evidence */}
                  <div className="bg-slate-50/60 p-4 rounded-xl border border-slate-200 space-y-2">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                      学生实际作答 (Student Answer)
                    </span>
                    <p className="text-xs text-slate-800 font-mono bg-white p-3 rounded-lg border border-slate-200 whitespace-pre-wrap">
                      {detail.student_answer || "（未作答）"}
                    </p>
                  </div>

                  {/* Step-by-Step Evidence Tree */}
                  {detail.step_details && detail.step_details.length > 0 && (
                    <div className="space-y-2.5">
                      <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider block flex items-center gap-1.5">
                        <Quote className="w-3.5 h-3.5" />
                        分步采分依据与答卷原文引用 (Evidence Quote Chain)
                      </span>

                      <div className="space-y-2">
                        {detail.step_details.map((step, sidx) => (
                          <div
                            key={sidx}
                            className={`p-3.5 rounded-xl border text-xs space-y-2 transition ${
                              step.is_hit
                                ? "bg-emerald-50/40 border-emerald-200"
                                : "bg-rose-50/40 border-rose-200"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {step.is_hit ? (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                ) : (
                                  <XCircle className="w-4 h-4 text-rose-600" />
                                )}
                                <span className="font-bold text-slate-800">
                                  步骤 {step.step_no} 采分核验
                                </span>
                              </div>
                              <span
                                className={`font-extrabold px-2 py-0.5 rounded text-xs ${
                                  step.is_hit
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-rose-100 text-rose-800"
                                }`}
                              >
                                得分：{step.score} / {step.max_score} 分
                              </span>
                            </div>

                            {/* Evidence Quote Highlight */}
                            <div className="bg-white p-2.5 rounded-lg border border-slate-200 flex items-start gap-2">
                              <span className="text-slate-400 font-serif text-lg leading-none">“</span>
                              <div className="space-y-1">
                                <span className="text-[11px] font-bold text-slate-500">
                                  提取答卷证据 (Quote)：
                                </span>
                                <p className="text-xs font-semibold text-slate-800">
                                  {step.evidence}
                                </p>
                              </div>
                            </div>

                            {/* Deduction reason if not hit */}
                            {step.reason && (
                              <p className="text-[11px] text-slate-500">
                                <span className="font-bold text-slate-600">评定理由：</span>
                                {step.reason}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI Feedback Card */}
                  {detail.ai_feedback && (
                    <div className="bg-indigo-50/60 p-3.5 rounded-xl border border-indigo-200/80 flex items-start gap-2.5">
                      <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                      <div className="text-xs space-y-0.5">
                        <span className="font-bold text-indigo-900 block">AI 导师评语与启发：</span>
                        <p className="text-slate-700 leading-relaxed font-medium">
                          {detail.ai_feedback}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400 border border-slate-200">
          暂无选中的学生答卷数据。
        </div>
      )}
    </div>
  );
};
