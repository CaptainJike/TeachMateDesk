import assert from "node:assert/strict";
import test from "node:test";
import { inferSingleChoiceAnswer } from "./objective-answer.js";

test("infers the supplied elementary algebra choice answers", () => {
  assert.equal(
    inferSingleChoiceAnswer("下列算式中，正确的是（ ）", [
      "$a+3=3a$",
      "$3a=a\\times a\\times a$",
      "$a^2=a\\times a$",
    ]),
    "C",
  );
  assert.equal(
    inferSingleChoiceAnswer("下面式子中，省略乘号写法正确的是（ ）", [
      "$12\\times t=t12$",
      "$b\\times y=by$",
      "$9\\times 3.7=93.7$",
    ]),
    "B",
  );
  assert.equal(
    inferSingleChoiceAnswer("玲玲今年 n 岁，比婷婷大 5 岁，再过 n 年后", ["$n+5$", "$n-5$", "$5$"]),
    "C",
  );
  assert.equal(
    inferSingleChoiceAnswer("每天读 b 页，c 天后还剩", ["$bc$", "$a-bc$", "$a\\div c-b$"]),
    "B",
  );
  assert.equal(
    inferSingleChoiceAnswer("电影院的第一排有 m 个座位，第 n 排，每一排都比前一排多一个", ["$m+1$", "$m+n$", "$m+(n-1)$"]),
    "C",
  );
});
