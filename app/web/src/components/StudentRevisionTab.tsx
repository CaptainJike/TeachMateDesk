import React, { useState, useEffect } from "react";
import {
  Sparkles,
  RotateCcw,
  RotateCw,
  CheckCircle2,
  TrendingUp,
  History,
  Send,
  HelpCircle,
  Lightbulb,
} from "lucide-react";
import type { StudentSubmission, GradingDetail, ExamPaper } from "../types.js";
import { formatQuestionLabel } from "../utils/question-label.js";

// In desktop/production the API and file service share one loopback origin.
// Vite proxies this path to the standalone file-server during development.
const FILE_SERVER_URL = "";

interface StudentRevisionTabProps {
  selectedExam: ExamPaper | null;
  submissions: StudentSubmission[];
  selectedSubmissionId: string;
  selectedDetailId: string;
  onSelectSubmission: (id: string) => void;
  onSelectDetail: (id: string) => void;
  onRefreshSubmissions: () => void;
}

const isObjectiveQuestion = (questionType?: string) =>
  ["SINGLE_CHOICE", "MULTI_CHOICE", "JUDGE"].includes((questionType || "").toUpperCase());

// Teachers must be able to confirm every unresolved item, including a
// low-confidence answer that AI already awarded full marks for.
// A zero score is a valid teacher-confirmed result. It must leave the
// review queue just like a full score; only unresolved review flags belong here.
const canReviewDetail = (detail: GradingDetail) =>
  !isObjectiveQuestion(detail.question_type) &&
  Boolean(detail.review_required && !detail.is_reviewed);

export const StudentRevisionTab: React.FC<StudentRevisionTabProps> = ({
  selectedExam,
  submissions,
  selectedSubmissionId,
  selectedDetailId,
  onSelectSubmission,
  onSelectDetail,
  onRefreshSubmissions,
}) => {
  const examSubmissions = selectedExam
    ? submissions.filter((s) => s.exam_id === selectedExam.id)
    : submissions;

  const currentSubmission =
    examSubmissions.find((s) => s.id === selectedSubmissionId) || examSubmissions[0];

  // Objective questions have a deterministic result. They are explained in
  // the report, but must not be presented as open-ended revision tasks.
  const imperfectDetails =
    currentSubmission?.grading_details.filter(canReviewDetail) || [];

  const currentDetail =
    imperfectDetails.find((d) => d.id === selectedDetailId) || imperfectDetails[0];

  const [revisedText, setRevisedText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingScore, setIsSavingScore] = useState(false);
  const [manualScore, setManualScore] = useState("");
  const [revisionError, setRevisionError] = useState("");
  const [showOriginalPaper, setShowOriginalPaper] = useState(false);
  const [paperRotations, setPaperRotations] = useState<Record<string, number>>({});
  const [originalPaperChecked, setOriginalPaperChecked] = useState(false);
  const [revisionSuccessResult, setRevisionSuccessResult] = useState<{
    newScore: number;
    deltaScore: number;
    feedback: string;
  } | null>(null);

  useEffect(() => {
    if (currentDetail) {
      setPaperRotations({});
      setRevisedText(currentDetail.student_answer || "");
      setManualScore(String(currentDetail.final_score));
      setRevisionSuccessResult(null);
      setOriginalPaperChecked(false);
    }
  }, [currentDetail?.id]);

  const handleSaveTeacherScore = async () => {
    if (!currentSubmission || !currentDetail) return;
    const score = Number(manualScore);
    if (!Number.isFinite(score) || score < 0 || score > currentDetail.max_score) {
      setRevisionError(`得分必须在 0 到 ${currentDetail.max_score} 之间`);
      return;
    }
    setIsSavingScore(true);
    setRevisionError("");
    try {
      const res = await fetch(`/api/submissions/${encodeURIComponent(currentSubmission.id)}/grading-details/${encodeURIComponent(currentDetail.id)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalScore: score, reason: "教师二次复核确认" }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || "保存得分失败");
      onRefreshSubmissions();
    } catch (error: any) {
      setRevisionError(error.message || "保存得分失败，请稍后重试");
    } finally {
      setIsSavingScore(false);
    }
  };

  const handleSubmitRevision = async () => {
    if (!currentSubmission || !currentDetail || !revisedText.trim()) return;
    setIsSubmitting(true);
    setRevisionError("");
    try {
      const res = await fetch("/api/revision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: currentSubmission.id,
          gradingDetailId: currentDetail.id,
          revisedAnswer: revisedText,
        }),
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRevisionError(result.error || "订正提交失败，请稍后重试");
        return;
      }
      setRevisionSuccessResult({
        newScore: result.newScore,
        deltaScore: result.deltaScore,
        feedback: result.revisionLog.feedback,
      });
      onRefreshSubmissions();
    } catch (e) {
      console.error(e);
      setRevisionError("订正提交失败，请检查网络后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            教师复核：订正建议与最终得分确认
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            AI 订正结果仅供参考；教师可直接调整最终得分，确认后本题将从待复核中移除
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-bold text-slate-600">当前学生：</label>
          <select
            value={currentSubmission?.id || ""}
            onChange={(event) => onSelectSubmission(event.target.value)}
            className="max-w-[220px] text-xs font-bold py-2 px-3 bg-white border border-indigo-200 rounded-xl text-indigo-700 outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {examSubmissions.map((submission) => (
              <option key={submission.id} value={submission.id}>
                {submission.student_name} · {submission.class_name || "未填写班级"}
              </option>
            ))}
          </select>
          <div className="text-xs font-bold bg-indigo-50 text-indigo-700 px-3.5 py-2 rounded-xl border border-indigo-200">
            待订正错题数：{imperfectDetails.length} 道
          </div>
        </div>
      </div>

      {/* Main Grid: Left Questions List, Right Instant Revision Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Imperfect Questions list */}
        <div className="lg:col-span-4 bg-white rounded-2xl p-4 border border-slate-200 shadow-sm space-y-3">
          <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2 pb-2 border-b border-slate-100">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            选择需要复核的主观题
          </h3>

          <div className="space-y-2">
            {!currentSubmission && (
              <div className="py-8 text-center text-xs text-slate-400">
                暂无已批改答卷。
              </div>
            )}
            {currentSubmission && imperfectDetails.length === 0 && (
              <div className="py-8 text-center text-xs leading-relaxed text-slate-400">
                当前答卷没有可订正的主观题。选择题、判断题已按标准答案直接判分，无需二次订正。
              </div>
            )}
            {imperfectDetails.map((d) => {
              const isSelected = currentDetail?.id === d.id;
              const isPerfect = d.final_score === d.max_score;
              return (
                <div
                  key={d.id}
                  onClick={() => onSelectDetail(d.id)}
                  className={`p-3 rounded-xl border cursor-pointer transition ${
                    isSelected
                      ? "border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500/20"
                      : isPerfect
                      ? "border-slate-200 bg-slate-50/40 opacity-70"
                      : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-800">
                      {formatQuestionLabel(d.question_num, d.sub_num)}
                    </span>
                    <span
                      className={`font-extrabold text-xs px-2 py-0.5 rounded ${
                        isPerfect
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {d.final_score} / {d.max_score} 分
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-600 line-clamp-1">
                    {d.stem_text}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Revision Workspace */}
        <div className="lg:col-span-8 space-y-6">
          {currentDetail ? (
            <>
              {/* Question Context & Heuristic Prompt */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-base text-slate-900">
                      {formatQuestionLabel(currentDetail.question_num, currentDetail.sub_num)}
                    </span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                      满分 {currentDetail.max_score} 分
                    </span>
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                      当前得分：{currentDetail.final_score} 分
                    </span>
                  </div>
                  {currentSubmission.source_files?.length ? (
                    <button
                      type="button"
                      onClick={() => setShowOriginalPaper(true)}
                      className="text-xs font-bold text-indigo-700 border border-indigo-200 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100"
                    >
                      查看原考生试卷
                    </button>
                  ) : null}
                </div>

                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs text-slate-800 font-medium leading-relaxed">
                  <span className="font-bold text-slate-500 block mb-1">题干：</span>
                  {currentDetail.stem_text}
                </div>

                {/* AI Tutor Hint Banner */}
                {currentDetail.ai_feedback && (
                  <div className="bg-indigo-50/70 p-4 rounded-xl border border-indigo-200 flex items-start gap-3">
                    <Lightbulb className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                    <div className="text-xs space-y-1">
                      <span className="font-bold text-indigo-900 block">
                        AI 导师启发式订正思路：
                      </span>
                      <p className="text-slate-700 leading-relaxed font-medium">
                        {currentDetail.ai_feedback}
                      </p>
                    </div>
                  </div>
                )}

                {/* Stored vision evidence: this is reused locally, no new model call or token cost. */}
                {(currentDetail.student_evidence?.length || currentDetail.answer_region) && (
                  <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3.5 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sky-900">已保存的原卷识别证据</span>
                      <span className="text-[11px] text-sky-700">复用已有视觉分析，不会重复调用模型</span>
                    </div>
                    {currentDetail.student_evidence?.map((evidence, index) => (
                      <p key={`${evidence}-${index}`} className="rounded-lg bg-white/80 border border-sky-100 p-2 text-slate-700 leading-relaxed">{evidence}</p>
                    ))}
                    {currentDetail.answer_region && (
                      <p className="text-sky-800">定位：第 {currentDetail.answer_region.page} 页 · {currentDetail.answer_region.description}</p>
                    )}
                  </div>
                )}

                {/* Revision Textarea */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 block">
                    输入您的二次订正作答 (Revised Answer)：
                  </label>
                  <p className="text-[11px] text-slate-500">
                    提交前请先对照原卷确认：学生是否确实写出了答案、算式和结论；如识别结果与原卷不一致，以原卷为准。
                  </p>
                  <textarea
                    value={revisedText}
                    onChange={(e) => setRevisedText(e.target.value)}
                    placeholder="根据上方启发式提示，完善您的答题要点与规范表述..."
                    rows={5}
                    className="w-full text-xs p-3.5 font-medium border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none leading-relaxed"
                  />
                </div>

                <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="text-xs font-bold text-indigo-900 block">教师最终得分</span>
                      <span className="text-[11px] text-indigo-700">确认后同步答卷总分，并将本题从待复核中移除。</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="number" min="0" max={currentDetail.max_score} step="0.5" value={manualScore} onChange={(e) => setManualScore(e.target.value)} className="w-20 rounded-lg border border-indigo-300 bg-white px-2 py-2 text-center text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500" />
                      <span className="text-xs text-slate-600">/ {currentDetail.max_score} 分</span>
                      <button type="button" onClick={() => void handleSaveTeacherScore()} disabled={isSavingScore} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{isSavingScore ? "保存中..." : "确认并保存"}</button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                  <input id="original-paper-checked" type="checkbox" checked={originalPaperChecked} onChange={(e) => setOriginalPaperChecked(e.target.checked)} className="accent-indigo-600" />
                  <label htmlFor="original-paper-checked">我已查看原考生试卷，并确认识别结果与原卷一致</label>
                </div>

                <div className="flex items-center justify-between pt-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 block">
                      提交后将由 ChineseExpertAgent 依据 Rubric 重判，并同步更新本题及答卷总分
                    </span>
                    {revisionError && (
                      <span className="text-xs font-semibold text-rose-600 block">{revisionError}</span>
                    )}
                  </div>

                  <button
                    onClick={handleSubmitRevision}
                    disabled={!revisedText.trim() || !originalPaperChecked || isSubmitting}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-white transition ${
                      revisedText.trim() && originalPaperChecked && !isSubmitting
                        ? "bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 shadow-md shadow-indigo-600/30"
                        : "bg-slate-300 cursor-not-allowed"
                    }`}
                  >
                    {isSubmitting ? (
                      <>
                        <RotateCcw className="w-4 h-4 animate-spin" />
                        <span>AI 增量重判中...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span>提交二次订正 (即时判分)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Original paper review modal: teacher verification comes before regrading. */}
              {showOriginalPaper && currentSubmission.source_files?.length ? (
                <div className="fixed inset-0 z-50 bg-slate-950/70 p-4 md:p-8 flex items-center justify-center" role="dialog" aria-modal="true">
                  <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden shadow-2xl flex flex-col">
                    <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                      <div>
                        <h3 className="font-bold text-slate-900">原考生试卷 · 教师核验</h3>
                        <p className="text-xs text-slate-500 mt-1">
                          当前题目区域：{currentDetail.answer_region?.description || `第 ${currentDetail.answer_region?.page || 1} 页`}；目前展示原始整页，便于核对上下文。
                        </p>
                      </div>
                      <button type="button" onClick={() => setShowOriginalPaper(false)} className="text-sm font-bold text-slate-500 hover:text-slate-900">关闭</button>
                    </div>
                    <div className="p-4 overflow-auto bg-slate-100 space-y-4">
                      {currentSubmission.source_files.map((file, index) => {
                        const rotation = paperRotations[file] || 0;
                        return (
                          <figure key={file} className="bg-white rounded-xl p-2 shadow-sm">
                            <div className="flex items-center justify-between px-2 pb-2">
                              <figcaption className="text-xs text-slate-500">第 {index + 1} 页 · {file}</figcaption>
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-slate-400">{rotation}°</span>
                                <button type="button" onClick={() => setPaperRotations((current) => ({ ...current, [file]: (rotation + 270) % 360 }))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-indigo-300 hover:text-indigo-700" aria-label={`第 ${index + 1} 页左转`}>
                                  <RotateCcw className="h-3 w-3" /> 左转
                                </button>
                                <button type="button" onClick={() => setPaperRotations((current) => ({ ...current, [file]: (rotation + 90) % 360 }))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-indigo-300 hover:text-indigo-700" aria-label={`第 ${index + 1} 页右转`}>
                                  <RotateCw className="h-3 w-3" /> 右转
                                </button>
                              </div>
                            </div>
                            <div className="overflow-auto bg-slate-50 p-2">
                              <img src={`${FILE_SERVER_URL}/files/${encodeURIComponent(file)}`} alt={`学生试卷第 ${index + 1} 页`} className="max-w-full h-auto mx-auto transition-transform duration-200" style={{ transform: `rotate(${rotation}deg)` }} />
                            </div>
                          </figure>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Instant Regrade Success Result Card */}
              {revisionSuccessResult && (
                <div className="bg-emerald-50 rounded-2xl p-6 border border-emerald-200 shadow-sm space-y-3 animate-in fade-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      <h4 className="font-bold text-base text-emerald-900">
                        订正重判已完成！
                      </h4>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-emerald-700">
                        重判得分：{revisionSuccessResult.newScore} / {currentDetail.max_score} 分
                      </span>
                      {revisionSuccessResult.deltaScore !== 0 && (
                        <span className={`flex items-center gap-1 text-xs font-extrabold text-white px-2.5 py-0.5 rounded-full shadow-sm ${
                          revisionSuccessResult.deltaScore > 0 ? "bg-emerald-600" : "bg-rose-600"
                        }`}>
                          <TrendingUp className="w-3 h-3" />
                          {revisionSuccessResult.deltaScore > 0 ? "+" : ""}{revisionSuccessResult.deltaScore} 分
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-emerald-800 leading-relaxed font-medium bg-white/80 p-3 rounded-xl border border-emerald-200">
                    {revisionSuccessResult.feedback}
                  </p>
                </div>
              )}

              {/* Revision History Logs */}
              {currentDetail.revision_logs && currentDetail.revision_logs.length > 0 && (
                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-3">
                  <h4 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                    <History className="w-4 h-4 text-slate-500" />
                    订正历史轨迹 (Revision History)
                  </h4>
                  <div className="space-y-2">
                    {currentDetail.revision_logs.map((log) => (
                      <div
                        key={log.id}
                        className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between text-slate-500 text-[11px]">
                          <span>第 {log.revision_round} 次订正</span>
                          <span className="font-bold text-indigo-700">
                            得分：{log.new_score} 分
                          </span>
                        </div>
                        <p className="text-slate-800 font-medium">
                          作答内容：{log.revised_answer}
                        </p>
                        <p className="text-slate-500 text-[11px]">{log.feedback}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="bg-white rounded-2xl p-12 text-center text-slate-400 border border-slate-200">
              {currentSubmission
                ? "该答卷暂无可订正题目。"
                : "请先导入并完成一份真实学生答卷的批改。"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
