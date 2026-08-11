import { parse, type ParserOptions, type ParseResult } from "@babel/parser";
import type { File } from "@babel/types";
import type { LanguageId } from "../core/types.js";

export function parseJavaScript(source: string, language: LanguageId): ParseResult<File> {
  const plugins: NonNullable<ParserOptions["plugins"]> = [];
  if (language === "typescript" || language === "tsx") plugins.push("typescript");
  if (language === "jsx" || language === "tsx") plugins.push("jsx");

  return parse(source, {
    sourceType: "unambiguous",
    plugins,
    tokens: true,
    ranges: true,
    attachComment: true,
    createParenthesizedExpressions: true,
    errorRecovery: false,
  });
}
