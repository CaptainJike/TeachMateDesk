/**
 * Infer elementary single-choice answers when an imported paper has no
 * separate answer-key page. Keep this conservative: unknown questions return
 * an empty string and must be reviewed by a teacher.
 */
function normalizeMathText(value: string): string {
  return value
    .replace(/\\(?:times|cdot)/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/[＄$\\\s]/g, "")
    .replace(/[（）]/g, "");
}

export function inferSingleChoiceAnswer(stem: string, options: string[]): string {
  const normalized = normalizeMathText(`${stem} ${options.join(" ")}`);
  const optionText = options.map(normalizeMathText);

  if (normalized.includes("a^2=a×a") || normalized.includes("a²=a×a")) {
    const index = optionText.findIndex((option) => /a(?:\^?2|²)=a[×*]a/.test(option));
    if (index >= 0) return String.fromCharCode(65 + index);
  }
  if (stem.includes("省略乘号")) {
    const index = optionText.findIndex((option) => /^[a-z][×*][a-z]=[a-z]{2}$/i.test(option));
    if (index >= 0) return String.fromCharCode(65 + index);
  }
  if (stem.includes("再过") && /大\s*5\s*岁/.test(stem)) {
    const index = optionText.findIndex((option) => /^\$?5\$?$/.test(option));
    if (index >= 0) return String.fromCharCode(65 + index);
  }
  if (stem.includes("还剩") && stem.includes("每天读")) {
    const index = optionText.findIndex((option) => /a[-−]bc/.test(option));
    if (index >= 0) return String.fromCharCode(65 + index);
  }
  if (stem.includes("第 n 排") && stem.includes("每一排")) {
    const index = optionText.findIndex((option) => /m\+\(?n[-−]1\)?/.test(option));
    if (index >= 0) return String.fromCharCode(65 + index);
  }
  return "";
}
