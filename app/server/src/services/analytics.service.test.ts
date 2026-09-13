import assert from "node:assert/strict";
import test from "node:test";
import { aggregateErrorTypeBreakdown } from "./analytics.service.js";
import type { GradingDetail } from "../db/store.js";

function detail(overrides: Partial<GradingDetail>): GradingDetail {
  return {
    id: "detail-1",
    submission_id: "submission-1",
    question_id: "question-1",
    question_num: 1,
    question_type: "SUBJECTIVE_SHORT",
    stem_text: "题目",
    student_answer: "答案",
    final_score: 0,
    ai_score: 0,
    max_score: 5,
    score_status: "WRONG",
    step_details: [],
    confidence: 0.9,
    is_reviewed: false,
    ...overrides,
  };
}

test("aggregates only persisted diagnoses for questions that actually lost points", () => {
  const result = aggregateErrorTypeBreakdown([
    detail({ error_type: "KNOWLEDGE_GAP" }),
    detail({ id: "detail-2", error_type: "LOGIC_STEP_MISSING", final_score: 2 }),
    // A teacher review may have fixed the score while the old AI diagnosis
    // remains on the detail; it must no longer count as a class error.
    detail({ id: "detail-3", error_type: "CALC_ERROR", final_score: 5, score_status: "FULL_CORRECT" }),
    // Missing/unknown diagnoses are not guessed by the analytics layer.
    detail({ id: "detail-4", error_type: "NONE" }),
    detail({ id: "detail-5", error_type: undefined }),
  ]);

  assert.deepEqual(result.breakdown, {
    KNOWLEDGE_GAP: 1,
    LOGIC_STEP_MISSING: 1,
    EXPRESSION_BIAS: 0,
    CALC_ERROR: 0,
  });
  assert.equal(result.total, 2);
});

test("returns zeroes for an empty result set", () => {
  const result = aggregateErrorTypeBreakdown([]);

  assert.equal(result.total, 0);
  assert.deepEqual(result.breakdown, {
    KNOWLEDGE_GAP: 0,
    LOGIC_STEP_MISSING: 0,
    EXPRESSION_BIAS: 0,
    CALC_ERROR: 0,
  });
});
