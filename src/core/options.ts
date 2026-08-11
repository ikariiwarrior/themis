import type { FormatOptions, LanguageId } from "./types.js";

export const DEFAULT_OPTIONS: Readonly<FormatOptions> = {
  language: "typescript",
  lineWidth: 120,
  indent: "    ",
};

export function resolveOptions(options: Partial<FormatOptions> = {}): FormatOptions {
  return {
    language: options.language ?? DEFAULT_OPTIONS.language,
    lineWidth: options.lineWidth ?? DEFAULT_OPTIONS.lineWidth,
    indent: options.indent ?? DEFAULT_OPTIONS.indent,
  };
}

export function languageFromPath(path: string): LanguageId {
  if (/\.svelte$/i.test(path)) return "svelte";
  if (/\.css$/i.test(path)) return "css";
  if (/\.json$/i.test(path)) return "json";
  if (/\.tsx$/i.test(path)) return "tsx";
  if (/\.jsx$/i.test(path)) return "jsx";
  if (/\.(?:ts|mts|cts)$/i.test(path)) return "typescript";
  return "javascript";
}
