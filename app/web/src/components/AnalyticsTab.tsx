import React, { useState, useEffect } from "react";
import {
  BarChart3,
  TrendingUp,
  Award,
  AlertTriangle,
  BookOpen,
  PieChart,
  Lightbulb,
} from "lucide-react";
import type { ExamPaper, ClassAnalytics } from "../types.js";

interface AnalyticsTabProps {
  selectedExam: ExamPaper | null;
}

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({ selectedExam }) => {
  const [selectedClass, setSelectedClass] = useState<string>("ALL");
  const [analytics, setAnalytics] = useState<ClassAnalytics | null>(null);

  useEffect(() => {
    if (!selectedExam) {
      setAnalytics(null);
      return;
    }

    let disposed = false;
    const loadAnalytics = async () => {
      const url =
        selectedClass === "ALL"
          ? `/api/analytics/${selectedExam.id}`
          : `/api/analytics/${selectedExam.id}?className=${encodeURIComponent(selectedClass)}`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`学情统计请求失败 (${res.status})`);
        const data = (await res.json()) as ClassAnalytics;
        if (!disposed) setAnalytics(data);
      } catch (error) {
        if (!disposed) console.error(error);
      }
    };

    // Grading runs asynchronously. Refresh while this tab is open so the
    // dashboard reflects newly persisted results without requiring navigation.
    void loadAnalytics();
    const refreshTimer = window.setInterval(() => void loadAnalytics(), 5000);
    return () => {
      disposed = true;
      window.clearInterval(refreshTimer);
    };
  }, [selectedExam?.id, selectedClass]);

  if (!analytics || analytics.totalStudents === 0) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400 border border-slate-200">
        暂无班级学情统计数据，请先在【批量智能批改】工作台完成答卷批阅。
      </div>
    );
  }

  const errorTypes = [
    {
      key: "KNOWLEDGE_GAP",
      label: "知识与概念掌握不足",
      count: analytics.errorTypeBreakdown?.KNOWLEDGE_GAP || 0,
      color: "bg-rose-500",
    },
    {
      key: "LOGIC_STEP_MISSING",
      label: "解题过程或关键步骤缺失",
      count: analytics.errorTypeBreakdown?.LOGIC_STEP_MISSING || 0,
      color: "bg-amber-500",
    },
    {
      key: "EXPRESSION_BIAS",
      label: "答案表达与要求不匹配",
      count: analytics.errorTypeBreakdown?.EXPRESSION_BIAS || 0,
      color: "bg-blue-500",
    },
    {
      key: "CALC_ERROR",
      label: "结果、判断或计算错误",
      count: analytics.errorTypeBreakdown?.CALC_ERROR || 0,
      color: "bg-purple-500",
    },
  ];

  // The denominator comes from the server's persisted, categorized error
  // records. Do not manufacture a denominator when there are no diagnoses.
  const totalErrors = analytics.errorTypeTotal ?? errorTypes.reduce((a, b) => a + b.count, 0);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            班级学情全景看板 (Class Analytics)
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            聚合多份答卷的分步采分与错因归类，辅助教师精准讲评与分层教学
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* 班级切换下拉选择框 */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-600">所属班级:</span>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100/80 text-blue-900 border border-blue-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-xs"
            >
              <option value="ALL">全部班级 (全样本)</option>
              {analytics.classList?.map((className) => (
                <option key={className} value={className}>
                  {className}
                </option>
              ))}
            </select>
          </div>

          <div className="text-xs font-bold text-slate-700 bg-slate-100 px-3.5 py-2 rounded-xl border border-slate-200">
            共统计 {analytics.totalStudents} 名学生答卷
          </div>
          <div className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-200">
            真实批改数据 · 已归类 {totalErrors} 题次
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-xs font-bold uppercase tracking-wider">
            班级平均得分
          </div>
          <p className="mt-2 text-2xl font-extrabold text-blue-700">
            {analytics.averageScore} <span className="text-xs text-slate-400 font-normal">/ {analytics.totalExamScore} 分</span>
          </p>
          <span className="text-[11px] text-blue-600 font-medium">
            得分率 {Math.round((analytics.averageScore / analytics.totalExamScore) * 100)}%
          </span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-xs font-bold uppercase tracking-wider">
            最高得分
          </div>
          <p className="mt-2 text-2xl font-extrabold text-emerald-600">
            {analytics.highestScore} <span className="text-xs text-slate-400 font-normal">分</span>
          </p>
          <span className="text-[11px] text-emerald-600 font-medium">
            表现优秀
          </span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-xs font-bold uppercase tracking-wider">
            最低得分
          </div>
          <p className="mt-2 text-2xl font-extrabold text-rose-600">
            {analytics.lowestScore} <span className="text-xs text-slate-400 font-normal">分</span>
          </p>
          <span className="text-[11px] text-rose-600 font-medium">
            需重点帮扶
          </span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div className="text-slate-500 text-xs font-bold uppercase tracking-wider">
            主观题采分点覆盖率
          </div>
          <p className="mt-2 text-2xl font-extrabold text-indigo-700">
            {analytics.rubricCoverageRate}%
          </p>
          <span className="text-[11px] text-indigo-600 font-medium">
            按真实采分步骤命中数计算
          </span>
        </div>
      </div>

      {/* Grid: Question Accuracy & Error Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Question Accuracy Table */}
        <div className="lg:col-span-7 bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-bold text-base text-slate-900 flex items-center gap-2 pb-2 border-b border-slate-100">
            <BookOpen className="w-4 h-4 text-blue-600" />
            题目得分率矩阵 (Question Accuracy Matrix)
          </h3>

          <div className="space-y-3">
            {analytics.questionAccuracy.map((q) => (
              <div key={q.questionNum} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800">
                    第 {q.questionNum} 题 ({q.questionType} - {q.scoreValue}分)
                  </span>
                  <span className="font-extrabold text-blue-700">
                    {q.accuracyRate}%
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-2 rounded-full ${
                      q.accuracyRate >= 80
                        ? "bg-emerald-500"
                        : q.accuracyRate >= 60
                        ? "bg-blue-500"
                        : "bg-rose-500"
                    }`}
                    style={{ width: `${q.accuracyRate}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Error Type Breakdown */}
        <div className="lg:col-span-5 bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-bold text-base text-slate-900 flex items-center gap-2 pb-2 border-b border-slate-100">
            <PieChart className="w-4 h-4 text-indigo-600" />
            失分原因分布（基于本卷批改结果）
          </h3>

          <div className="space-y-3">
            {totalErrors === 0 && (
              <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs font-medium text-slate-500">
                当前筛选范围暂无已归类的失分题次。
              </p>
            )}
            {errorTypes.map((err) => {
              const pct = totalErrors > 0 ? Math.round((err.count / totalErrors) * 100) : 0;
              return (
                <div key={err.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">{err.label}</span>
                    <span className="font-bold text-slate-900">
                      {err.count} 题次 ({pct}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-2 rounded-full ${err.color}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-blue-50/70 p-4 rounded-xl border border-blue-200 text-xs space-y-1 mt-4">
            <span className="font-bold text-blue-900 flex items-center gap-1">
              <Lightbulb className="w-3.5 h-3.5 text-blue-600" />
              数据说明
            </span>
            <p className="text-slate-700 leading-relaxed font-medium">
              用于发现班级共性失分模式，辅助确定讲评重点和分层辅导对象。数据来自当前试卷、当前班级筛选范围内已完成或待复核的真实批改结果，按最终失分题次及批改时保存的诊断归类统计；它不代表固定学科知识点，未归类的失分不会被臆测到任何类别。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
