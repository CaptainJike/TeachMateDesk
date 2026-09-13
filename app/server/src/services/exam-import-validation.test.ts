import assert from "node:assert/strict";
import test from "node:test";
import {
  ExamImportValidationError,
  assertLikelyExamDocument,
} from "./exam-import-validation.js";

test("assertLikelyExamDocument rejects a PRD before question parsing", () => {
  assert.throws(
    () => assertLikelyExamDocument(
      "# Skyward 一体化教培系统产品需求文档（PRD）\n文档版本：V1.0\n编制日期：2026-09-10\n1. 平台创建租户",
      "Skyward PRD"
    ),
    (error: unknown) => {
      assert.ok(error instanceof ExamImportValidationError);
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /不是试卷/);
      return true;
    }
  );
});

test("assertLikelyExamDocument accepts a normal exam", () => {
  assert.doesNotThrow(() => assertLikelyExamDocument(
    "八年级语文期末试卷\n姓名：____ 班级：____\n1. 下列读音正确的是（ ）（3分）\nA. 炽热 B. 畸形\n2. 简析诗歌主旨。（4分）",
    "八年级语文期末试卷"
  ));
});

test("assertLikelyExamDocument does not reject one isolated PRD term", () => {
  assert.doesNotThrow(() => assertLikelyExamDocument(
    "阅读下面关于 PRD 的材料，回答问题。\n1. 概括材料主要内容。（4分）",
    "信息技术测试卷"
  ));
});
