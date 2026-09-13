import { test, describe } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { DocumentAgent } from "./agents/document.agent.js";
import { QuestionParserAgent } from "./agents/question-parser.agent.js";
import { RouterAgent } from "./agents/router.agent.js";
import { RubricAgent } from "./agents/rubric.agent.js";
import { ChineseExpertAgent } from "./agents/chinese-expert.agent.js";
import { FeedbackAgent } from "./agents/feedback.agent.js";
import { ChineseExpertAgentPool } from "./pool/chinese-expert.pool.js";
import { FileBasedRetriever } from "./retriever/file-based-retriever.js";

describe("TeachMate 6 Core Agents & Engine Pipeline", () => {
  const kbDir = path.resolve(process.cwd(), "..", "..", "knowledge-base");
  const retriever = new FileBasedRetriever(kbDir);

  test("1. Document Agent parses structured text", async () => {
    const docAgent = new DocumentAgent();
    const res = await docAgent.parseDocument({
      filePath: "mock_exam.pdf",
      fileType: "pdf",
      rawText: "1. 下列读音正确的是 ( )\nA. 炽热 B. 畸形\n\n2. 简析《赤壁》的主旨情感。",
    });
    assert.strictEqual(res.pageCount, 1);
    assert.ok(res.structuredMarkdown.includes("炽热"));
  });

  test("2. Question Parser Agent splits questions", async () => {
    const parser = new QuestionParserAgent();
    const res = await parser.parseQuestions(
      "1. 下列读音正确的是 ( )\nA. 炽热 B. 畸形\n2. 简析《赤壁》的主旨情感。(4分)",
      "八年级语文仿真测试"
    );
    assert.ok(res.questions.length >= 2);
    assert.strictEqual(res.questions[0].num, 1);
  });

  test("3. Router Agent infers multi-dimensional metadata", () => {
    const router = new RouterAgent();
    const metaChoice = router.route({
      stem: "下列加点字注音完全正确的一项是 ( )",
      score: 3,
    });
    assert.strictEqual(metaChoice.question_type, "single_choice");
    assert.strictEqual(metaChoice.model_tier, "TIER_1_FAST");

    const metaSub = router.route({
      stem: "简析文中划线句子表达了作者怎样的思想感情？",
      score: 6,
    });
    assert.strictEqual(metaSub.domain, "reading_comprehension");
    assert.strictEqual(metaSub.model_tier, "TIER_3_DEEP");
  });

  test("4. File-Based Knowledge Retriever retrieves lessons", async () => {
    const results = await retriever.retrieve({
      subject: "chinese",
      grade: "grade8",
      volume: "volume_1",
      query: "杜牧 赤壁 诗词五首",
    });
    assert.ok(results.length > 0);
    assert.ok(results[0].title.includes("诗词五首") || results[0].content.length > 0);
  });

  test("5. Rubric Agent generates step-by-step scoring rules", async () => {
    const rubricAgent = new RubricAgent(retriever, "MIDDLE");
    const res = await rubricAgent.generateRubric({
      questionTitle: "阅读理解主观简答",
      stem: "简析杜牧《赤壁》中‘东风不与周郎便，铜雀春深锁二乔’的艺术构思与主旨。",
      maxScore: 4,
      referenceAnswer: "以小见大，借周瑜赤壁之战的侥幸胜利，抒发作者怀才不遇、英雄无用武之地的抑郁不平之气。",
    });
    assert.strictEqual(res.totalScore, 4);
    assert.ok(res.rubricSteps.length >= 1);
  });

  test("6. Chinese Expert Agent grades subjective question with evidence quote", async () => {
    const expert = new ChineseExpertAgent(retriever, "MIDDLE", "TIER_2_STANDARD");
    const res = await expert.gradeQuestion({
      questionTitle: "第 3 题",
      stem: "简析杜牧《赤壁》后两句的主旨情感。",
      maxScore: 4,
      referenceAnswer: "借周瑜赤壁之战抒发怀才不遇之感。",
      studentAnswer: "这两句诗运用以小见大的手法，借赤壁之战抒发了诗人自己怀才不遇的抑郁之情。",
      rubricSteps: [
        {
          step_no: 1,
          score: 2,
          criteria: "准确指出以小见大或借古讽今的手法",
          keywords: ["以小见大", "借古讽今", "手法"],
        },
        {
          step_no: 2,
          score: 2,
          criteria: "准确分析出怀才不遇或英雄失意的抑郁情感",
          keywords: ["怀才不遇", "抑郁", "英雄失意"],
        },
      ],
    });
    assert.strictEqual(res.totalAwardedScore, 4);
    assert.strictEqual(res.stepEvaluations.length, 2);
    assert.ok(res.stepEvaluations[0].is_hit);
    assert.ok(res.stepEvaluations[0].evidence.length > 0);
  });

  test("7. Feedback Agent produces error diagnosis", async () => {
    const feedback = new FeedbackAgent();
    const res = await feedback.generateFeedback({
      questionNum: 3,
      stem: "简析杜牧《赤壁》后两句的主旨情感。",
      maxScore: 4,
      awardedScore: 2,
      deductionReasons: ["缺少对作者怀才不遇情感的明确概括"],
      studentAnswer: "这两句诗写的是东风帮助周瑜打赢了赤壁之战。",
      referenceAnswer: "抒发怀才不遇之感。",
    });
    assert.ok(res.errorType !== "NONE");
    assert.ok(res.heuristicHint.length > 0);
  });

  test("8. ChineseExpertAgentPool acquires, executes, and releases workers", async () => {
    const pool = new ChineseExpertAgentPool(3, "MIDDLE", retriever);
    assert.strictEqual(pool.getPoolStats().capacity, 3);
    assert.strictEqual(pool.getPoolStats().idleWorkers, 3);

    const score = await pool.executeGrading("TIER_2_STANDARD", async (agent) => {
      const g = await agent.gradeQuestion({
        questionTitle: "选择题测试",
        questionType: "single_choice",
        stem: "下列读音完全正确的是 ( )",
        maxScore: 3,
        referenceAnswer: "A",
        studentAnswer: "A",
      });
      return g.totalAwardedScore;
    });

    assert.strictEqual(score, 3);
    assert.strictEqual(pool.getPoolStats().idleWorkers, 3);
  });

  test("9. ChineseExpertAgent extracts an option from answer evidence", async () => {
    const expert = new ChineseExpertAgent(retriever, "MIDDLE", "TIER_1_FAST");
    const result = await expert.gradeQuestion({
      questionTitle: "选择题",
      questionType: "SINGLE_CHOICE",
      stem: "下列算式中，正确的是（ ）",
      maxScore: 3,
      referenceAnswer: "C",
      studentAnswer: "下列算式中，正确的是（C）。",
    });
    assert.equal(result.totalAwardedScore, 3);
    assert.equal(result.stepEvaluations[0].evidence, "C");

    const repaired = await expert.gradeQuestion({
      questionTitle: "导入试卷旧标准答案",
      questionType: "SINGLE_CHOICE",
      stem: "下列算式中，正确的是（ ）",
      options: ["a+3=3a", "3a=a×a×a", "a^2=a×a"],
      maxScore: 3,
      referenceAnswer: "A",
      standardAnswerTeacherEdited: false,
      studentAnswer: "（C）",
    });
    assert.equal(repaired.totalAwardedScore, 3);
  });
});
