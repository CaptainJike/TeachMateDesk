import React from "react";
import {
  FolderKanban,
  UploadCloud,
  FileCheck2,
  Layers,
  GraduationCap,
  Sparkles,
  BarChart3,
  Cpu,
  BookOpen,
} from "lucide-react";

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  selectedExamTitle?: string;
  selectedExamId?: string;
  exams?: Array<{ id: string; title: string; questions: any[]; total_score: number; status: string }>;
  onSelectExam?: (exam: any) => void;
  onOpenModelConfig?: () => void;
  modelConfigured?: boolean;
  modelProvider?: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  selectedExamTitle,
  selectedExamId,
  exams = [],
  onSelectExam,
  onOpenModelConfig,
  modelConfigured = false,
  modelProvider = "",
}) => {
  const navItems = [
    { id: "exams", label: "试卷管理", icon: FolderKanban, tag: "题库" },
    { id: "review", label: "试卷与量规审核", icon: FileCheck2, tag: "教师" },
    { id: "batch", label: "批量智能批改", icon: Layers, tag: "教师" },
    { id: "report", label: "诊断报告与证据链", icon: GraduationCap, tag: "学生" },
    { id: "revision", label: "在线订正与辅导", icon: Sparkles, tag: "学生" },
    { id: "analytics", label: "班级学情全景", icon: BarChart3, tag: "统计" },
  ];

  return (
    <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-50 shadow-xs">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-2 sm:gap-4">
          {/* Brand Logo & Title */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="hidden sm:block">
              <div className="flex items-center gap-1.5 leading-none">
                <span className="font-black text-base tracking-tight bg-gradient-to-r from-blue-700 via-indigo-700 to-violet-800 bg-clip-text text-transparent">
                  TeachMate
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-blue-50 text-blue-700 border border-blue-200/60">
                  AI 批改
                </span>
              </div>
              {exams.length > 1 && onSelectExam ? (
                <select
                  value={selectedExamId || ""}
                  onChange={(e) => {
                    const ex = exams.find((x) => x.id === e.target.value);
                    if (ex) onSelectExam(ex);
                  }}
                  className="text-[11px] font-semibold text-blue-800 bg-blue-50/80 hover:bg-blue-100/80 border border-blue-200 rounded-md px-1.5 py-0.5 mt-0.5 max-w-[140px] md:max-w-[200px] cursor-pointer focus:outline-none"
                >
                  {exams.map((ex) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.title}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-[11px] text-slate-500 truncate max-w-[140px] md:max-w-[200px] mt-0.5 font-medium">
                  {selectedExamTitle || "智能作业批改系统"}
                </p>
              )}
            </div>
          </div>

          {/* Nav Tabs */}
          <nav className="flex items-center gap-1.5 p-1 bg-slate-100/90 rounded-2xl border border-slate-200/70 overflow-x-auto flex-shrink-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all select-none cursor-pointer ${
                    isActive
                      ? "bg-white text-blue-700 shadow-sm shadow-slate-300/60 ring-1 ring-slate-200/50"
                      : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? "text-blue-600" : "text-slate-400"}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Model Status Badge */}
          <button onClick={onOpenModelConfig} title={modelConfigured ? `模型服务商：${modelProvider || "未知"}` : "尚未配置 AI 模型，点击配置"} className={`hidden lg:flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border flex-shrink-0 transition-colors cursor-pointer ${modelConfigured ? "text-emerald-600 bg-emerald-50/80 border-emerald-200/70 hover:bg-emerald-100" : "text-red-600 bg-red-50 border-red-200 hover:bg-red-100"}`}>
            <Cpu className={`w-3.5 h-3.5 ${modelConfigured ? "text-emerald-600 animate-pulse" : "text-red-500"}`} />
            <span className={`font-semibold text-[11px] ${modelConfigured ? "text-emerald-800" : "text-red-700"}`}>Agent池就绪 · {modelConfigured ? "已配置" : "未配置"}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
