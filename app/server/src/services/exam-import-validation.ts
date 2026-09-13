export class ExamImportValidationError extends Error {
  public readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "ExamImportValidationError";
  }
}

interface DocumentMarker {
  label: string;
  pattern: RegExp;
}

const PRODUCT_DOCUMENT_MARKERS: DocumentMarker[] = [
  { label: "产品需求文档", pattern: /产品需求文档/i },
  { label: "PRD", pattern: /(?:^|[\s（(])PRD(?:[\s：:）)]|$)/im },
  { label: "文档版本", pattern: /文档版本\s*[：:]/i },
  { label: "编制日期", pattern: /编制日期\s*[：:]/i },
  { label: "目标工程", pattern: /目标工程\s*[：:]/i },
];

/**
 * 在调用模型前拦截明显选错的非试卷文档，避免将章节编号误切成题目。
 * 这里只使用强 PRD 特征，避免误伤包含普通说明文字的真实试卷。
 */
export function assertLikelyExamDocument(rawText: string, title = ""): void {
  const text = rawText.trim();
  if (!text) {
    throw new ExamImportValidationError("试卷内容为空，请检查文件后重新上传。");
  }

  const sample = `${title}\n${text.slice(0, 6000)}`;
  const matchedMarkers = PRODUCT_DOCUMENT_MARKERS
    .filter(({ pattern }) => pattern.test(sample))
    .map(({ label }) => label);
  const hasProductDocumentIdentity = matchedMarkers.includes("产品需求文档")
    || matchedMarkers.includes("PRD");
  const metadataMarkerCount = matchedMarkers.filter((label) =>
    ["文档版本", "编制日期", "目标工程"].includes(label)
  ).length;

  if (hasProductDocumentIdentity && metadataMarkerCount >= 1) {
    throw new ExamImportValidationError(
      `检测到上传内容更像产品需求文档（命中：${matchedMarkers.join("、")}），不是试卷。请检查文件后重新上传。`
    );
  }
}
