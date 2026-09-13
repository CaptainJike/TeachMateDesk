import fs from "node:fs/promises";
import path from "node:path";
import { ChineseExpertAgent, FileBasedRetriever } from "@teachmate/agent-engine";

interface EvalSample {
  id: string;
  type: string;
  stem: string;
  max_score: number;
  reference_answer: string;
  rubric_steps?: Array<{ step_no: number; score: number; criteria: string; keywords: string[] }>;
  student_answer: string;
  expert_score: number;
}

async function runEvaluation() {
  console.log("=========================================================");
  console.log("  TeachMate 标准基准评测集自动化评估 (Evaluation Benchmark)");
  console.log("=========================================================\n");

  const datasetPath = path.resolve(process.cwd(), "datasets", "chinese-reading.json");
  const raw = await fs.readFile(datasetPath, "utf-8");
  const samples: EvalSample[] = JSON.parse(raw);

  const kbDir = path.resolve(process.cwd(), "..", "..", "knowledge-base");
  const retriever = new FileBasedRetriever(kbDir);
  const report: Array<Record<string, unknown>> = [];

  let objectiveTotal = 0;
  let objectiveCorrect = 0;
  let subjectiveTotal = 0;
  let totalAbsoluteError = 0;
  let evidenceRecallHits = 0;

  for (const sample of samples) {
    const agent = new ChineseExpertAgent(retriever, "MIDDLE", "TIER_2_STANDARD");
    const start = Date.now();
    const result = await agent.gradeQuestion({
      questionTitle: sample.id,
      questionType: sample.type,
      stem: sample.stem,
      maxScore: sample.max_score,
      referenceAnswer: sample.reference_answer,
      rubricSteps: sample.rubric_steps,
      studentAnswer: sample.student_answer,
    });
    const latency = Date.now() - start;

    const diff = Math.abs(result.totalAwardedScore - sample.expert_score);

    if (sample.type === "single_choice" || sample.type === "judge") {
      objectiveTotal++;
      if (diff === 0) objectiveCorrect++;
      console.log(`[客观题 ${sample.id}]: 专家分=${sample.expert_score}, AI分=${result.totalAwardedScore}, 判定=${diff === 0 ? "✅ 正确" : "❌ 错误"} (${latency}ms)`);
    } else {
      subjectiveTotal++;
      totalAbsoluteError += diff;
      const hasQuote = result.stepEvaluations.every((s) => s.evidence && s.evidence.length > 0);
      if (hasQuote) evidenceRecallHits++;
      console.log(`[主观题 ${sample.id}]: 专家分=${sample.expert_score}, AI分=${result.totalAwardedScore}, 偏差=${diff}分, 证据链=${hasQuote ? "✅ 具备Quote" : "❌ 缺失"} (${latency}ms)`);
    }
    report.push({ id: sample.id, expected: sample.expert_score, actual: result.totalAwardedScore, absoluteError: diff, confidence: result.confidence, reviewRequired: result.reviewRequired, latencyMs: latency, evidenceValid: result.stepEvaluations.every((step) => !step.is_hit || sample.student_answer.includes(step.evidence)) });
  }

  const objAcc = objectiveTotal > 0 ? ((objectiveCorrect / objectiveTotal) * 100).toFixed(1) : "100.0";
  const mae = subjectiveTotal > 0 ? (totalAbsoluteError / subjectiveTotal).toFixed(2) : "0.00";
  const quoteRecall = subjectiveTotal > 0 ? ((evidenceRecallHits / subjectiveTotal) * 100).toFixed(1) : "100.0";

  console.log("\n---------------------------------------------------------");
  console.log("  评测度量指标汇总 (Evaluation DoD Acceptance Report)");
  console.log("---------------------------------------------------------");
  console.log(`1. 客观题准确率 (Objective Accuracy):     ${objAcc}%  (标准: >= 99%)`);
  console.log(`2. 主观题打分平均偏离度 (MAE):          ${mae} 分   (标准: <= 0.5 分)`);
  console.log(`3. 原文证据引用召回率 (Evidence Recall):  ${quoteRecall}%  (标准: 100%)`);
  await fs.writeFile(path.resolve(process.cwd(), "evaluation-report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), objectiveAccuracy: Number(objAcc), subjectiveMae: Number(mae), evidenceRecall: Number(quoteRecall), samples: report }, null, 2));
  console.log("4. 详细报告: app/evaluation/evaluation-report.json");
  console.log("=========================================================\n");
}

runEvaluation().catch(console.error);
