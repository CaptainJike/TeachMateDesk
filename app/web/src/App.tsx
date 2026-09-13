import React, { useState, useEffect } from "react";
import { Navbar } from "./components/Navbar.js";
import { ExamManagementTab } from "./components/ExamManagementTab.js";
import { TeacherReviewTab } from "./components/TeacherReviewTab.js";
import { BatchGradingTab } from "./components/BatchGradingTab.js";
import { StudentReportTab } from "./components/StudentReportTab.js";
import { StudentRevisionTab } from "./components/StudentRevisionTab.js";
import { AnalyticsTab } from "./components/AnalyticsTab.js";
import type { ExamPaper, StudentSubmission } from "./types.js";

export function App() {
  const [activeTab, setActiveTab] = useState("exams");
  const [exams, setExams] = useState<ExamPaper[]>([]);
  const [selectedExam, setSelectedExam] = useState<ExamPaper | null>(null);
  const [submissions, setSubmissions] = useState<StudentSubmission[]>([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string>("");
  const [selectedRevisionDetailId, setSelectedRevisionDetailId] = useState<string>("");

  const fetchExams = async () => {
    try {
      const res = await fetch("/api/exams");
      if (res.ok) {
        const data: ExamPaper[] = await res.json();
        setExams(data);
        if (data.length > 0) {
          setSelectedExam((prev) => {
            if (!prev) return data[0];
            const found = data.find((e) => e.id === prev.id);
            return found || data[0];
          });
        } else {
          setSelectedExam(null);
        }
      }
    } catch (e) {
      console.error("Failed to fetch exams:", e);
    }
  };

  const fetchSubmissions = async () => {
    try {
      const res = await fetch("/api/submissions");
      if (res.ok) {
        const data: StudentSubmission[] = await res.json();
        setSubmissions(data);
        setSelectedSubmissionId((previousId) => {
          if (data.length === 0) return "";
          return data.some((submission) => submission.id === previousId)
            ? previousId
            : data[0].id;
        });
      }
    } catch (e) {
      console.error("Failed to fetch submissions:", e);
    }
  };

  useEffect(() => {
    fetchExams();
    fetchSubmissions();
  }, []);

  const handleSelectSubmissionFromBatch = (id: string) => {
    setSelectedSubmissionId(id);
    setActiveTab("report");
  };

  const handleGoToRevision = (detailId: string) => {
    setSelectedRevisionDetailId(detailId);
    setActiveTab("revision");
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col selection:bg-blue-600 selection:text-white">
      {/* Navigation Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedExamTitle={selectedExam?.title}
        selectedExamId={selectedExam?.id}
        exams={exams}
        onSelectExam={setSelectedExam}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === "exams" && (
          <ExamManagementTab
            exams={exams}
            selectedExam={selectedExam}
            onSelectExam={setSelectedExam}
            onNavigateToTab={(tabId, exam) => {
              if (exam) setSelectedExam(exam);
              setActiveTab(tabId);
            }}
            onRefreshExams={fetchExams}
          />
        )}

        {activeTab === "review" && (
          <TeacherReviewTab
            exams={exams}
            selectedExam={selectedExam}
            onSelectExam={setSelectedExam}
            onRefreshExams={fetchExams}
          />
        )}

        {activeTab === "batch" && (
          <BatchGradingTab
            selectedExam={selectedExam}
            submissions={submissions}
            onSelectSubmission={handleSelectSubmissionFromBatch}
            onRefreshSubmissions={fetchSubmissions}
          />
        )}

        {activeTab === "report" && (
          <StudentReportTab
            selectedExam={selectedExam}
            submissions={submissions}
            selectedSubmissionId={selectedSubmissionId}
            onSelectSubmission={setSelectedSubmissionId}
            onGoToRevision={handleGoToRevision}
          />
        )}

        {activeTab === "revision" && (
          <StudentRevisionTab
            selectedExam={selectedExam}
            submissions={submissions}
            selectedSubmissionId={selectedSubmissionId}
            selectedDetailId={selectedRevisionDetailId}
            onSelectSubmission={setSelectedSubmissionId}
            onSelectDetail={setSelectedRevisionDetailId}
            onRefreshSubmissions={fetchSubmissions}
          />
        )}

        {activeTab === "analytics" && (
          <AnalyticsTab selectedExam={selectedExam} />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700">TeachMate 智能作业批改系统</span>
            <span>·</span>
            <span>基于 pi-agent-core 微内核 & pi-ai 多模型分层路由</span>
          </div>
          <div>
            <span>初中/高中语文学科完整闭环 · 采分点硬证据链保障</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
export default App;
