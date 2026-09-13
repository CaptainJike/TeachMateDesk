import { createHash } from "node:crypto";
import type { StudentSubmission } from "../db/store.js";

export const normalizeIdentityPart = (value?: string): string =>
  (value || "").trim().toLocaleLowerCase("zh-CN").replace(/[\s\-—_()（）]+/g, "");

export const normalizeStudentAnswer = (value?: string): string =>
  (value || "")
    .replace(/[＝﹦]/g, "=")
    .replace(/[×✕✖]/g, "×")
    .replace(/[÷／]/g, "÷")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[，]/g, ",")
    .replace(/[。]/g, ".")
    .replace(/[\u00a0\t\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

export const createStudentIdentityKey = (params: {
  studentName?: string;
  className?: string;
  studentNumber?: string;
}): string => {
  const studentNumber = normalizeIdentityPart(params.studentNumber);
  if (studentNumber) return `number:${studentNumber}`;
  const studentName = normalizeIdentityPart(params.studentName);
  const className = normalizeIdentityPart(params.className);
  return studentName && className ? `name:${className}:${studentName}` : "";
};

export const stableStudentId = (identityKey: string): string =>
  `stu_${createHash("sha256").update(identityKey).digest("hex").slice(0, 16)}`;

export const findDuplicateSubmission = (params: {
  submissions: Iterable<StudentSubmission>;
  examId: string;
  sourceHash?: string;
  identityKey?: string;
}): { submission: StudentSubmission; type: "EXACT_FILE" | "SAME_STUDENT" } | undefined => {
  return findDuplicateSubmissions(params)[0];
};

/** Return every matching record, not just the first one. This also repairs
 * databases that already contain duplicates from an interrupted replacement. */
export const findDuplicateSubmissions = (params: {
  submissions: Iterable<StudentSubmission>;
  examId: string;
  sourceHash?: string;
  identityKey?: string;
}): Array<{ submission: StudentSubmission; type: "EXACT_FILE" | "SAME_STUDENT" }> => {
  const matches: Array<{ submission: StudentSubmission; type: "EXACT_FILE" | "SAME_STUDENT" }> = [];
  for (const submission of params.submissions) {
    if (submission.exam_id !== params.examId) continue;
    if (params.sourceHash && submission.source_hash === params.sourceHash) {
      matches.push({ submission, type: "EXACT_FILE" });
      continue;
    }
    if (params.identityKey) {
      const existing = submission.identity_key || createStudentIdentityKey({
        studentName: submission.student_name,
        className: submission.class_name,
        studentNumber: submission.student_number,
      });
      if (existing === params.identityKey) matches.push({ submission, type: "SAME_STUDENT" });
    }
  }
  return matches;
};

export const sha256 = (contents: Buffer | string): string =>
  createHash("sha256").update(contents).digest("hex");
