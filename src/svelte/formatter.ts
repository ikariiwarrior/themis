import { parse } from "svelte/compiler";
import type { FormatterEngine, FormatOptions, LanguageId } from "../core/types.js";

interface SvelteAttribute {
  name: string;
  value: Array<{ type: string; data?: string }> | true;
}

interface SvelteScript {
  start: number;
  end: number;
  attributes: SvelteAttribute[];
  content: { start: number; end: number };
}

interface SvelteRoot {
  instance?: SvelteScript | null;
  module?: SvelteScript | null;
  css?: SvelteScript | null;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

function languageAttribute(node: SvelteScript): string | undefined {
  const lang = node.attributes.find((attribute) => attribute.name === "lang");
  if (!lang) return undefined;
  if (!Array.isArray(lang.value) || lang.value.length !== 1 || lang.value[0].type !== "Text") return undefined;
  return lang.value[0].data?.toLowerCase();
}

function scriptLanguage(script: SvelteScript): "javascript" | "typescript" | undefined {
  const value = languageAttribute(script);
  if (value === undefined) return "javascript";
  if (value === "ts" || value === "typescript") return "typescript";
  if (value === "js" || value === "javascript") return "javascript";
  return undefined;
}

function isCssStyle(style: SvelteScript): boolean {
  const value = languageAttribute(style);
  return value === undefined || value === "css";
}

function dedent(content: string): string {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const nonempty = lines.filter((line) => line.trim() !== "");
  const common = nonempty.length
    ? Math.min(...nonempty.map((line) => line.match(/^[\t ]*/)?.[0].length ?? 0))
    : 0;
  return lines.map((line) => line.slice(Math.min(common, line.length))).join("\n");
}

function indentScript(content: string, indent: string): string {
  const body = content.trimEnd().split("\n").map((line) => line.length ? `${indent}${line}` : "").join("\n");
  return `\n${body}\n`;
}

export class SvelteFormatter implements FormatterEngine {
  readonly languages: readonly LanguageId[] = ["svelte"];

  constructor(
    private readonly scripts: FormatterEngine,
    private readonly styles: FormatterEngine,
  ) {}

  format(source: string, options: FormatOptions): string {
    const normalized = source.replace(/\r\n?/g, "\n");
    const ast = parse(normalized, { modern: true }) as unknown as SvelteRoot;
    const replacements: Replacement[] = [];

    for (const script of [ast.module, ast.instance]) {
      if (!script) continue;
      const language = scriptLanguage(script);
      if (!language) continue;
      const original = normalized.slice(script.content.start, script.content.end);
      const code = dedent(original);
      if (!code.trim()) continue;
      const formatted = this.scripts.format(`${code}\n`, { ...options, language });
      replacements.push({
        start: script.content.start,
        end: script.content.end,
        text: indentScript(formatted, options.indent),
      });
    }

    if (ast.css) {
      if (isCssStyle(ast.css)) {
        const original = normalized.slice(ast.css.content.start, ast.css.content.end);
        const css = dedent(original);
        if (css.trim()) {
          const formatted = this.styles.format(`${css}\n`, { ...options, language: "css" });
          replacements.push({
            start: ast.css.content.start,
            end: ast.css.content.end,
            text: indentScript(formatted, options.indent),
          });
        }
      }
    }

    let result = normalized;
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
      result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
    }
    return result.trimEnd() + "\n";
  }
}
