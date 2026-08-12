import postcss, { type AtRule, type Container, type Declaration, type Node, type Rule } from "postcss";
import { themisDirective } from "../core/directives.js";
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

function ignoredCssNodes(container: Container, ignored = new Set<Node>()): Set<Node> {
  let ignoreNext = false;
  let inRegion = false;

  for (const node of container.nodes ?? []) {
    const directive = node.type === "comment" ? themisDirective(`/*${node.text}*/`) : undefined;
    if (directive === "ignore-start") {
      if (inRegion) throw new Error("Nested themis-ignore-start directives are not allowed.");
      inRegion = true;
      continue;
    }
    if (directive === "ignore-end") {
      if (!inRegion) throw new Error("themis-ignore-end has no matching themis-ignore-start.");
      inRegion = false;
      continue;
    }
    if (directive === "ignore") {
      ignoreNext = true;
      continue;
    }

    if (inRegion || (ignoreNext && node.type !== "comment")) {
      ignored.add(node);
      if (ignoreNext && node.type !== "comment") ignoreNext = false;
      continue;
    }

    if ((node.type === "rule" || node.type === "atrule") && node.nodes) ignoredCssNodes(node, ignored);
  }

  if (inRegion) throw new Error("themis-ignore-start has no matching themis-ignore-end in the same CSS block.");
  if (ignoreNext) throw new Error("themis-ignore must be followed by a CSS node in the same block.");
  return ignored;
}

function formatContainer(container: Container, depth: number, indent: string, ignored: Set<Node>, isRoot = false): void {
  const nodes = container.nodes ?? [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (ignored.has(node)) continue;
    const prefix = preservedPrefix(node);
    node.raws.before = isRoot
      ? `${index === 0 ? "" : "\n\n"}${prefix}`
      : `\n${indent.repeat(depth + 1)}${prefix}`;

    if (node.type === "decl") formatDeclaration(node);
    if (node.type === "rule") formatRule(node);
    if (node.type === "atrule") formatAtRule(node);
    if ((node.type === "rule" || node.type === "atrule") && node.nodes) {
      formatContainer(node, isRoot ? 0 : depth + 1, indent, ignored);
    }
  }

  container.raws.after = isRoot ? "\n" : nodes.length ? `\n${indent.repeat(depth)}` : "";
  if (!isRoot && nodes.length && !nodes.some((node) => ignored.has(node))) container.raws.semicolon = true;
}

export class CssFormatter implements FormatterEngine {
  readonly languages: readonly LanguageId[] = ["css"];

  format(source: string, options: FormatOptions): string {
    const root = postcss.parse(source.replace(/\r\n?/g, "\n"), { from: undefined });
    const ignored = ignoredCssNodes(root);
    formatContainer(root, 0, options.indent, ignored, true);
    return root.toString().trimEnd() + "\n";
  }
}
