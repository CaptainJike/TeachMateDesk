import React from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

interface MathTextProps {
  children: string;
  className?: string;
}

const latexTokenPattern = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$/g;

export function normalizeLatexEscapes(value: string): string {
  return value.replace(
    /\\{2,}(?=[()[\]]|sqrt\b|frac\b|dfrac\b|tfrac\b|times\b|div\b|pm\b|geq?\b|leq?\b|neq\b|cdot\b|angle\b|perp\b|parallel\b)/g,
    "\\"
  );
}

export const MathText: React.FC<MathTextProps> = ({ children, className = "" }) => {
  const source = normalizeLatexEscapes(children || "");
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  latexTokenPattern.lastIndex = 0;
  while ((match = latexTokenPattern.exec(source)) !== null) {
    if (match.index > cursor) {
      parts.push(source.slice(cursor, match.index));
    }

    const expression = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
    const displayMode = match[2] !== undefined || match[3] !== undefined;
    try {
      const html = katex.renderToString(expression, {
        displayMode,
        throwOnError: false,
        strict: "ignore",
        trust: false,
      });
      parts.push(
        <span
          key={`${match.index}-${expression}`}
          className={displayMode ? "block my-1 overflow-x-auto" : "inline-block align-baseline"}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    } catch {
      parts.push(match[0]);
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < source.length) {
    parts.push(source.slice(cursor));
  }

  return <span className={`whitespace-pre-wrap ${className}`}>{parts}</span>;
};
