export function formatQuestionLabel(questionNum: number, subNum?: string): string {
  const main = String(questionNum);
  const cleanSub = String(subNum || "").trim().replace(/^第\s*/, "").replace(/题$/, "");
  if (!cleanSub) return `第 ${main} 题`;

  // Imports may contain either a local sub-number ("1") or a complete path
  // ("5.1.2"). Keep the complete path visible so repeated major numbers are
  // never mistaken for separate copies of the same question.
  const normalizedSub = cleanSub.replace(/[．、-]/g, ".");
  const fullPrefix = `${main}.`;
  const label = normalizedSub === main
    ? `${main}.1`
    : normalizedSub.startsWith(fullPrefix)
      ? normalizedSub
      : `${main}.${normalizedSub}`;
  return `第 ${label} 题`;
}
