import assert from "node:assert/strict";
import test from "node:test";
import {
  autoAssignPaperScore,
  normalizeScore,
  validatePaperScore,
  type ScorableQuestion,
} from "./paper-score.service.js";

function sum(questions: ScorableQuestion[]): number {
  return Math.round(questions.reduce((total, question) => total + (question.score || 0), 0) * 1000) / 1000;
}

function makeMathPaper(): ScorableQuestion[] {
  const questions: ScorableQuestion[] = [];
  const push = (questionNumber: number, subNumber: string, type: string, sectionTitle: string, stem: string) => {
    questions.push({ questionNumber, subNumber, type, sectionTitle, stem, score: null, scoreSource: null });
  };
  for (let i = 1; i <= 10; i += 1) push(1, `1.${i}`, "fill_blank", "一、填空题", "填一填。");
  for (let i = 1; i <= 5; i += 1) push(2, `2.${i}`, "judge", "二、判断题", "判断对错。");
  for (let i = 1; i <= 5; i += 1) push(3, `3.${i}`, "single_choice", "三、选择题", "选择正确答案。");
  for (let i = 1; i <= 12; i += 1) push(4, `4.${i}`, "subjective_short", "四、计算题", "计算下面各题。");
  for (let i = 1; i <= 2; i += 1) push(5, `5.${i}`, "subjective_short", "五、操作题", "动手操作。");
  for (let i = 1; i <= 6; i += 1) push(6, `6.${i}`, "subjective_short", "六、解决问题", "列式解答。");
  return questions;
}

test("用例一：完全没有分数且未填写总分时，按 100 分自动配分", () => {
  const questions = makeMathPaper();
  const result = autoAssignPaperScore(questions, { subject: "math" });
  assert.equal(result.summary.totalScore, 100);
  assert.equal(sum(questions), 100);
  assert.equal(result.summary.configuredTotalScore, 100);
  assert.equal(result.summary.autoQuestionCount, questions.length);
  assert.ok(questions.every((question) => (question.score || 0) > 0));
  assert.ok(questions.every((question) => question.scoreSource === "auto"));
  assert.ok(validatePaperScore(result.assignments, 100).valid);
});

test("用例二：完全没有分数且用户设置 120 分时，合计严格等于 120", () => {
  const questions = makeMathPaper();
  const result = autoAssignPaperScore(questions, { subject: "math", totalScore: 120 });
  assert.equal(result.summary.totalScore, 120);
  assert.equal(sum(questions), 120);
  assert.ok(validatePaperScore(result.assignments, 120).valid);
});

test("用例三：部分题型已有原卷分值，固定分值不被修改，其余分配剩余分数", () => {
  const questions = makeMathPaper();
  // 选择题每题 2 分（原卷明确），计算题每题 2.5 分（原卷明确）
  questions
    .filter((question) => question.sectionTitle === "三、选择题")
    .forEach((question) => {
      question.score = 2;
      question.scoreSource = "original";
    });
  questions
    .filter((question) => question.sectionTitle === "四、计算题")
    .forEach((question) => {
      question.score = 2.5;
      question.scoreSource = "original";
    });

  const result = autoAssignPaperScore(questions, { subject: "math", totalScore: 100 });
  assert.equal(result.summary.fixedScore, 10 + 30);
  assert.equal(result.summary.totalScore, 100);
  assert.equal(sum(questions), 100);

  const choiceScores = questions.filter((question) => question.sectionTitle === "三、选择题");
  assert.ok(choiceScores.every((question) => question.score === 2 && question.scoreSource === "original"));

  const calcScores = questions.filter((question) => question.sectionTitle === "四、计算题");
  assert.ok(calcScores.every((question) => question.score === 2.5 && question.scoreSource === "original"));

  assert.ok(questions.every((question) => (question.score || 0) > 0));
  assert.ok(validatePaperScore(result.assignments, 100).valid);
});

test("用例四：全部题目均已有原卷分数时不执行自动配分", () => {
  const questions: ScorableQuestion[] = [
    { questionNumber: 1, type: "single_choice", stem: "选择题", score: 20, scoreSource: "original" },
    { questionNumber: 2, type: "judge", stem: "判断题", score: 10, scoreSource: "original" },
    { questionNumber: 3, type: "subjective_short", sectionTitle: "解决问题", stem: "解决问题", score: 70, scoreSource: "original" },
  ];
  const result = autoAssignPaperScore(questions, { subject: "math", totalScore: 100 });
  assert.equal(result.summary.autoQuestionCount, 0);
  assert.equal(result.summary.fixedScore, 100);
  assert.deepEqual(questions.map((question) => question.score), [20, 10, 70]);
  assert.ok(questions.every((question) => question.scoreSource === "original"));
});

test("用例五：7 道题总分 20，题量无法整除时按整数优先分配且合计精确", () => {
  const questions: ScorableQuestion[] = Array.from({ length: 7 }, (_, index) => ({
    questionNumber: index + 1,
    type: "judge",
    stem: "判断",
    score: null,
    scoreSource: null,
  }));
  const result = autoAssignPaperScore(questions, { subject: "math", totalScore: 20 });
  assert.equal(sum(questions), 20);
  assert.deepEqual(questions.map((question) => question.score), [3, 3, 3, 3, 3, 3, 2]);
  assert.equal(result.summary.totalScore, 20);
});

test("用例六：复杂题平均分值明显高于判断题等简单客观题", () => {
  const questions = makeMathPaper();
  autoAssignPaperScore(questions, { subject: "math", totalScore: 100 });
  const average = (sectionTitle: string) => {
    const list = questions.filter((question) => question.sectionTitle === sectionTitle);
    return list.reduce((total, question) => total + (question.score || 0), 0) / list.length;
  };
  assert.ok(average("六、解决问题") > average("四、计算题"));
  assert.ok(average("四、计算题") > average("二、判断题"));
  assert.ok(average("二、判断题") >= 1);
});

test("用例七：人工分值（manual）在重新配分时不会被覆盖", () => {
  const questions = makeMathPaper();
  const essay = questions[questions.length - 1];
  essay.sectionTitle = "七、附加题";
  essay.score = 12;
  essay.scoreSource = "manual";

  const result = autoAssignPaperScore(questions, { subject: "math", totalScore: 100, forceReassign: true });
  assert.equal(essay.score, 12);
  assert.equal(essay.scoreSource, "manual");
  assert.equal(result.summary.totalScore, 100);
  assert.equal(sum(questions), 100);
  assert.equal(result.summary.fixedQuestionCount, 1);
});

test("异常场景：原卷分值合计超过配置总分时保留原卷分值并使用原卷总分", () => {
  const questions: ScorableQuestion[] = [
    { questionNumber: 1, type: "single_choice", stem: "选择题", score: 30, scoreSource: "original" },
    { questionNumber: 2, type: "subjective_short", sectionTitle: "计算题", stem: "计算", score: 40, scoreSource: "original" },
    { questionNumber: 3, type: "subjective_short", sectionTitle: "解决问题", stem: "解决问题", score: 40, scoreSource: "original" },
  ];
  const result = autoAssignPaperScore(questions, { subject: "math", totalScore: 100 });
  assert.ok(result.summary.conflict);
  assert.equal(result.summary.conflict?.identifiedTotalScore, 110);
  assert.equal(result.summary.totalScore, 110);
  assert.deepEqual(questions.map((question) => question.score), [30, 40, 40]);
});

test("同类型小题尽量等分：10 道选择题共 20 分时每题 2 分", () => {
  const questions: ScorableQuestion[] = Array.from({ length: 10 }, (_, index) => ({
    questionNumber: 3,
    subNumber: `3.${index + 1}`,
    type: "single_choice",
    sectionTitle: "三、选择题",
    stem: "选择",
    score: null,
  }));
  autoAssignPaperScore(questions, { subject: "math", totalScore: 20 });
  assert.ok(questions.every((question) => question.score === 2));
});

test("AI 推测分值（ai）不作为最终分值来源，会被程序重新配分", () => {
  const questions = makeMathPaper();
  questions.forEach((question) => {
    question.score = 3;
    question.scoreSource = "ai";
  });
  const result = autoAssignPaperScore(questions, { subject: "math", totalScore: 100 });
  assert.equal(result.summary.autoQuestionCount, questions.length);
  assert.equal(sum(questions), 100);
  assert.ok(questions.every((question) => question.scoreSource === "auto"));
});

test("语文试卷识别到作文时作文分值显著高于客观题", () => {
  const questions: ScorableQuestion[] = [];
  for (let i = 1; i <= 10; i += 1) {
    questions.push({ questionNumber: 1, subNumber: `1.${i}`, type: "fill_blank", sectionTitle: "一、看拼音写词语", stem: "看拼音写词语", score: null });
  }
  for (let i = 1; i <= 3; i += 1) {
    questions.push({ questionNumber: 2, subNumber: `2.${i}`, type: "subjective_short", sectionTitle: "二、阅读理解", stem: "阅读短文，回答问题。", score: null });
  }
  questions.push({ questionNumber: 3, type: "essay", sectionTitle: "三、作文", stem: "以“难忘的一天”为题写一篇作文。", score: null });

  autoAssignPaperScore(questions, { subject: "chinese", totalScore: 100 });
  const essay = questions[questions.length - 1];
  const reading = questions.filter((question) => question.sectionTitle === "二、阅读理解");
  const words = questions.filter((question) => question.sectionTitle === "一、看拼音写词语");
  assert.equal(sum(questions), 100);
  assert.ok((essay.score || 0) >= 25, `作文分值应显著偏高，实际 ${essay.score}`);
  assert.ok((essay.score || 0) > (reading[0].score || 0));
  assert.ok((essay.score || 0) > (words[0].score || 0));
});

test("normalizeScore 统一到 0.5 分最小单位", () => {
  assert.equal(normalizeScore(1.67), 1.5);
  assert.equal(normalizeScore(3.33), 3.5);
  assert.equal(normalizeScore(4.78), 5);
  assert.equal(normalizeScore(2), 2);
});

test("空题目列表不会抛错", () => {
  const result = autoAssignPaperScore([], { subject: "math", totalScore: 100 });
  assert.equal(result.assignments.length, 0);
  assert.equal(result.summary.totalScore, 0);
});
