import postcss, { type AtRule, type Container, type Declaration, type Node, type Rule } from "postcss";
import type { FormatterEngine, FormatOptions, LanguageId } from "../core/types.js";

function preservedPrefix(node: Node): string {
  return (node.raws.before ?? "").replace(/[\t\n\r ]/g, "");
}

function formatDeclaration(declaration: Declaration): void {
  const between = declaration.raws.between ?? ":";
  if (/^[\t\n\r ]*:[\t\n\r ]*$/.test(between)) declaration.raws.between = ": ";
}

function formatAtRule(atRule: AtRule): void {
  atRule.raws.afterName = atRule.params ? " " : "";
  if (atRule.nodes) atRule.raws.between = " ";
}

function formatRule(rule: Rule): void {
  rule.raws.between = " ";
}

function formatContainer(container: Container, depth: number, indent: string, isRoot = false): void {
  const nodes = container.nodes ?? [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const prefix = preservedPrefix(node);
    node.raws.before = isRoot
      ? `${index === 0 ? "" : "\n\n"}${prefix}`
      : `\n${indent.repeat(depth + 1)}${prefix}`;

    if (node.type === "decl") formatDeclaration(node);
    if (node.type === "rule") formatRule(node);
    if (node.type === "atrule") formatAtRule(node);
    if ((node.type === "rule" || node.type === "atrule") && node.nodes) {
      formatContainer(node, isRoot ? 0 : depth + 1, indent);
    }
  }

  container.raws.after = isRoot ? "\n" : nodes.length ? `\n${indent.repeat(depth)}` : "";
  if (!isRoot && nodes.length) container.raws.semicolon = true;
}

export class CssFormatter implements FormatterEngine {
  readonly languages: readonly LanguageId[] = ["css"];

  format(source: string, options: FormatOptions): string {
    const root = postcss.parse(source.replace(/\r\n?/g, "\n"), { from: undefined });
    formatContainer(root, 0, options.indent, true);
    return root.toString().trimEnd() + "\n";
  }
}
