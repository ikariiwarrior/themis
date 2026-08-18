import { parse } from "svelte/compiler";
import type { FormatterEngine, FormatOptions, LanguageId } from "../core/types.js";

interface Node {
  type: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
}

interface Fragment {
  nodes: Node[];
}

interface SvelteAttribute extends Node {
  name: string;
  value: Array<Node & { data?: string }> | Node | true;
}

interface SvelteScript extends Node {
  start: number;
  end: number;
  attributes: SvelteAttribute[];
  content: { start: number; end: number };
}

interface SvelteRoot {
  fragment: Fragment;
  instance?: SvelteScript | null;
  module?: SvelteScript | null;
  css?: SvelteScript | null;
}

interface Replacement {
  start: number;
  end: number;
  text: string;
}

const ELEMENT_TYPES = new Set([
  "Component", "RegularElement", "SvelteBody", "SvelteComponent", "SvelteDocument", "SvelteElement",
  "SvelteBoundary", "SvelteFragment", "SvelteHead", "SvelteOptions", "SvelteSelf", "SvelteWindow",
  "SlotElement", "TitleElement",
]);

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

function indentRegion(content: string, indent: string): string {
  const body = content.trimEnd().split("\n").map((line) => line.length ? `${indent}${line}` : "").join("\n");
  return `\n${body}\n`;
}

function isNode(value: unknown): value is Node {
  return !!value && typeof value === "object" && typeof (value as Node).type === "string";
}

function whitespaceOnly(node: Node, source: string): boolean {
  return node.type === "Text" && node.start !== undefined && node.end !== undefined
    && source.slice(node.start, node.end).trim() === "";
}

function lineIndent(depth: number, options: FormatOptions): string {
  return options.indent.repeat(Math.max(0, depth));
}

function structuralWhitespace(original: string, indent: string): string {
  const authoredBreaks = (original.match(/\n/g) ?? []).length;
  return `${"\n".repeat(Math.max(1, authoredBreaks))}${indent}`;
}

function indentContinuations(value: string, indent: string): string {
  return value.split("\n").map((line, index) => index === 0 || line.length === 0 ? line : `${indent}${line}`).join("\n");
}

function openingTagEnd(source: string, node: Node, attributes: Node[]): number {
  const lastAttribute = attributes[attributes.length - 1];
  const searchFrom = lastAttribute?.end ?? (node.start ?? 0) + 1;
  const position = source.indexOf(">", searchFrom);
  return position >= 0 && (node.end === undefined || position < node.end) ? position + 1 : node.start ?? 0;
}

function closingTagStart(source: string, node: Node, openingEnd: number): number | undefined {
  if (node.end === undefined || source.slice(node.start, openingEnd).trimEnd().endsWith("/>")) return undefined;
  const openingName = typeof node.name === "string"
    ? node.name
    : source.slice(node.start, openingEnd).match(/^<([^\s/>]+)/)?.[1];
  if (!openingName) return undefined;
  const marker = `</${openingName}`;
  const position = source.lastIndexOf(marker, node.end);
  if (position < openingEnd) return undefined;
  const suffix = source.slice(position + marker.length, node.end);
  return /^\s*>/.test(suffix) ? position : undefined;
}

function formatExpression(
  source: string,
  expression: Node,
  scripts: FormatterEngine,
  options: FormatOptions,
  language: "javascript" | "typescript",
): string {
  if (expression.start === undefined || expression.end === undefined) return "";
  const original = source.slice(expression.start, expression.end);
  try {
    const prefix = "__themis_expression__( ";
    const suffix = " );";
    const formatted = scripts.format(`${prefix}${original}${suffix}\n`, { ...options, language });
    const start = formatted.indexOf("(") + 1;
    const end = formatted.lastIndexOf(");");
    if (start <= 0 || end < start) return original;
    return dedent(formatted.slice(start, end).trim());
  } catch {
    return original;
  }
}

function formatDeclaration(
  source: string,
  declaration: Node,
  scripts: FormatterEngine,
  options: FormatOptions,
  language: "javascript" | "typescript",
): string {
  if (declaration.start === undefined || declaration.end === undefined) return "";
  const original = source.slice(declaration.start, declaration.end);
  try {
    const formatted = scripts.format(`${original};\n`, { ...options, language }).trimEnd();
    return formatted.endsWith(";") ? formatted.slice(0, -1) : formatted;
  } catch {
    return original;
  }
}

function expressionNodes(value: unknown, result: Node[] = [], seen = new Set<Node>()): Node[] {
  if (Array.isArray(value)) {
    for (const item of value) expressionNodes(item, result, seen);
    return result;
  }
  if (!value || typeof value !== "object") return result;
  const record = value as Record<string, unknown>;
  for (const key of ["expression", "test", "context", "key"] as const) {
    const expression = record[key];
    if (isNode(expression) && !seen.has(expression)) {
      seen.add(expression);
      result.push(expression);
    }
  }
  if (Array.isArray(record.parameters)) {
    for (const parameter of record.parameters) {
      if (isNode(parameter) && !seen.has(parameter)) {
        seen.add(parameter);
        result.push(parameter);
      }
    }
  }
  for (const [key, child] of Object.entries(record)) {
    if (["expression", "test", "context", "key", "parameters", "metadata", "loc", "parent"].includes(key)) continue;
    if (child && typeof child === "object") expressionNodes(child, result, seen);
  }
  return result;
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
    const claimed: Array<{ start: number; end: number }> = [];
    const markupLanguage = ast.instance && scriptLanguage(ast.instance) === "typescript" ? "typescript" : "javascript";

    const replace = (start: number, end: number, text: string, claim = false): void => {
      if (claim) claimed.push({ start, end });
      if (normalized.slice(start, end) === text) return;
      replacements.push({ start, end, text });
    };

    const formatAttribute = (attribute: Node): string => {
      if (attribute.start === undefined || attribute.end === undefined) return "";
      const original = normalized.slice(attribute.start, attribute.end);
      const nested = expressionNodes(attribute)
        .filter((expression) => expression.start !== undefined && expression.end !== undefined)
        .sort((left, right) => (right.start ?? 0) - (left.start ?? 0));
      let result = original;
      for (const expression of nested) {
        const start = expression.start! - attribute.start;
        const end = expression.end! - attribute.start;
        result = result.slice(0, start)
          + formatExpression(normalized, expression, this.scripts, options, markupLanguage)
          + result.slice(end);
      }
      return result;
    };

    const normalizeFragment = (
      fragment: Fragment | undefined,
      start: number,
      end: number,
      parentDepth: number,
      force: boolean,
      collapseTrailing = false,
    ): void => {
      if (!fragment || !force || end < start) return;
      const nodes = fragment.nodes.filter((node) => !whitespaceOnly(node, normalized));
      if (nodes.length === 0) return;
      const childIndent = lineIndent(parentDepth + 1, options);
      const parentIndent = lineIndent(parentDepth, options);
      const contentStart = (node: Node): number => {
        if (node.type !== "Text") return node.start!;
        const text = normalized.slice(node.start, node.end);
        return node.start! + (text.match(/^\s*/)?.[0].length ?? 0);
      };
      const contentEnd = (node: Node): number => {
        if (node.type !== "Text") return node.end!;
        const text = normalized.slice(node.start, node.end);
        return node.end! - (text.match(/\s*$/)?.[0].length ?? 0);
      };
      const firstStart = contentStart(nodes[0]);
      replace(start, firstStart, structuralWhitespace(normalized.slice(start, firstStart), childIndent));
      for (let index = 0; index < nodes.length - 1; index++) {
        const gapStart = contentEnd(nodes[index]);
        const gapEnd = contentStart(nodes[index + 1]);
        if (normalized.slice(gapStart, gapEnd).trim() === "") {
          replace(gapStart, gapEnd, structuralWhitespace(normalized.slice(gapStart, gapEnd), childIndent));
        }
      }
      const lastEnd = contentEnd(nodes[nodes.length - 1]);
      replace(lastEnd, end, collapseTrailing
        ? ""
        : structuralWhitespace(normalized.slice(lastEnd, end), parentIndent));
    };

    const visitFragment = (fragment: Fragment | undefined, depth: number): void => {
      if (!fragment) return;
      for (const node of fragment.nodes) visitNode(node, depth);
    };

    const fragmentEnd = (fragment: Fragment | null | undefined, fallback: number): number => {
      if (!fragment?.nodes.length) return fallback;
      return Math.max(fallback, ...fragment.nodes.map((child) => child.end ?? fallback));
    };

    const branchMarker = (
      fragment: Fragment | null | undefined,
      from: number,
      to: number,
      marker: string,
      syntaxEnd?: number,
    ): { start: number; end: number } | undefined => {
      from = fragmentEnd(fragment, from);
      const start = normalized.indexOf(marker, from);
      if (start < 0 || start >= to) return undefined;
      const closing = normalized.indexOf("}", Math.max(start, syntaxEnd ?? start));
      if (closing < 0 || closing >= to) return undefined;
      return { start, end: closing + 1 };
    };

    const blockOpeningEnd = (node: Node): number => {
      const syntaxNodes = [node.expression, node.test, node.context, node.key].filter(isNode);
      if (node.type === "AwaitBlock" && node.pending === null) {
        if (node.then !== null && isNode(node.value)) syntaxNodes.push(node.value);
        else if (isNode(node.error)) syntaxNodes.push(node.error);
      }
      if (Array.isArray(node.parameters)) syntaxNodes.push(...node.parameters.filter(isNode));
      const searchFrom = Math.max(node.start ?? 0, ...syntaxNodes.map((syntax) => syntax.end ?? node.start ?? 0));
      const closing = normalized.indexOf("}", searchFrom);
      return closing >= 0 && (node.end === undefined || closing < node.end) ? closing + 1 : node.start ?? 0;
    };

    const openingWillExpand = (node: Node, depth: number): boolean => {
      if (node.start === undefined || node.end === undefined || !ELEMENT_TYPES.has(node.type)) return false;
      const attributes = Array.isArray(node.attributes) ? node.attributes.filter(isNode) : [];
      if (attributes.length === 0) return false;
      const openingEnd = openingTagEnd(normalized, node, attributes);
      const prefix = normalized.slice(node.start, attributes[0].start).trimEnd();
      const originalOpening = normalized.slice(node.start, openingEnd);
      const ending = originalOpening.trimEnd().endsWith("/>") ? "/>" : ">";
      const formattedAttributes = attributes.map(formatAttribute);
      const compact = `${prefix} ${formattedAttributes.join(" ")} ${ending}`.replace(` ${ending}`, ending === ">" ? ">" : " />");
      const column = node.start - (normalized.lastIndexOf("\n", node.start - 1) + 1);
      return originalOpening.includes("\n") || formattedAttributes.some((attribute) => attribute.includes("\n"))
        || column + compact.length > options.lineWidth;
    };

    const fragmentWillBeMultiline = (fragment: Fragment | undefined, depth: number): boolean => {
      if (!fragment) return false;
      return fragment.nodes.some((child) => {
        if (child.type.endsWith("Block")) return true;
        if (!ELEMENT_TYPES.has(child.type)) return false;
        return openingWillExpand(child, depth) || fragmentWillBeMultiline(child.fragment as Fragment | undefined, depth + 1);
      });
    };

    const visitBlock = (node: Node, depth: number): void => {
      const start = node.start!;
      const end = node.end!;
      const openingEnd = blockOpeningEnd(node);
      const closingStart = normalized.lastIndexOf(`{/${node.type.replace("Block", "").toLowerCase()}}`, end);

      if (node.type === "IfBlock") {
        const consequent = node.consequent as Fragment;
        const alternate = node.alternate as Fragment | null;
        const elseIf = alternate?.nodes.length === 1 && alternate.nodes[0].type === "IfBlock"
          && alternate.nodes[0].elseif === true ? alternate.nodes[0] : undefined;
        const marker = alternate
          ? branchMarker(consequent, openingEnd, closingStart, "{:else", elseIf?.test && isNode(elseIf.test) ? elseIf.test.end : undefined)
          : undefined;
        normalizeFragment(consequent, openingEnd, marker?.start ?? closingStart, depth, true);
        if (alternate && marker && !elseIf) normalizeFragment(alternate, marker.end, closingStart, depth, true);
        visitFragment(consequent, depth + 1);
        if (elseIf) visitBlock(elseIf, depth);
        else visitFragment(alternate ?? undefined, depth + 1);
      } else if (node.type === "EachBlock") {
        const body = node.body as Fragment;
        const fallback = node.fallback as Fragment | null;
        const marker = fallback ? branchMarker(body, openingEnd, closingStart, "{:else") : undefined;
        const context = isNode(node.context) ? node.context : undefined;
        const expression = isNode(node.expression) ? node.expression : undefined;
        if (typeof node.index === "string") {
          const comma = normalized.indexOf(",", context?.end ?? expression?.end ?? openingEnd);
          const indexStart = comma >= 0 && comma < openingEnd ? normalized.indexOf(node.index, comma + 1) : -1;
          if (indexStart >= 0 && indexStart < openingEnd) replace(comma + 1, indexStart, " ");
        }
        normalizeFragment(body, openingEnd, marker?.start ?? closingStart, depth, true);
        if (fallback && marker) normalizeFragment(fallback, marker.end, closingStart, depth, true);
        visitFragment(body, depth + 1);
        visitFragment(fallback ?? undefined, depth + 1);
      } else if (node.type === "AwaitBlock") {
        const pending = node.pending as Fragment | null;
        const then = node.then as Fragment | null;
        const caught = node.catch as Fragment | null;
        const value = isNode(node.value) ? node.value : undefined;
        const error = isNode(node.error) ? node.error : undefined;
        const thenMarker = branchMarker(pending, openingEnd, closingStart, "{:then", value?.end);
        const catchMarker = branchMarker(then ?? pending, thenMarker?.end ?? openingEnd, closingStart, "{:catch", error?.end);
        if (pending) normalizeFragment(pending, openingEnd, thenMarker?.start ?? catchMarker?.start ?? closingStart, depth, true);
        if (then) {
          const thenStart = thenMarker?.end ?? (!pending ? openingEnd : undefined);
          if (thenStart !== undefined) normalizeFragment(then, thenStart, catchMarker?.start ?? closingStart, depth, true);
        }
        if (caught) {
          const catchStart = catchMarker?.end ?? (!pending && !then ? openingEnd : undefined);
          if (catchStart !== undefined) normalizeFragment(caught, catchStart, closingStart, depth, true);
        }
        for (const pattern of [node.value, node.error]) {
          if (!isNode(pattern) || pattern.start === undefined || pattern.end === undefined) continue;
          replace(pattern.start, pattern.end,
            formatExpression(normalized, pattern, this.scripts, options, markupLanguage), true);
        }
        visitFragment(pending ?? undefined, depth + 1);
        visitFragment(then ?? undefined, depth + 1);
        visitFragment(caught ?? undefined, depth + 1);
      } else {
        const fragment = (node.fragment ?? node.body) as Fragment | undefined;
        normalizeFragment(fragment, openingEnd, closingStart, depth, true);
        if (node.type === "SnippetBlock" && Array.isArray(node.parameters)) {
          const parameters = node.parameters.filter(isNode);
          const first = parameters[0];
          const last = parameters[parameters.length - 1];
          if (first?.start !== undefined && last?.end !== undefined) {
            const range: Node = { type: "SnippetParameters", start: first.start, end: last.end };
            replace(first.start, last.end,
              formatExpression(normalized, range, this.scripts, options, markupLanguage), true);
          }
        }
        visitFragment(fragment, depth + 1);
      }
    };

    const visitNode = (node: Node, depth: number): void => {
      if (node.start === undefined || node.end === undefined) return;
      if (ELEMENT_TYPES.has(node.type)) {
        const attributes = Array.isArray(node.attributes) ? node.attributes.filter(isNode) : [];
        const openingEnd = openingTagEnd(normalized, node, attributes);
        if (attributes.length > 0) {
          const prefix = normalized.slice(node.start, attributes[0].start).trimEnd();
          const originalOpening = normalized.slice(node.start, openingEnd);
          const ending = originalOpening.trimEnd().endsWith("/>") ? "/>" : ">";
          const formattedAttributes = attributes.map(formatAttribute);
          const compact = `${prefix} ${formattedAttributes.join(" ")} ${ending}`.replace(` ${ending}`, ending === ">" ? ">" : " />");
          const column = node.start - (normalized.lastIndexOf("\n", node.start - 1) + 1);
          const multiline = originalOpening.includes("\n") || formattedAttributes.some((attribute) => attribute.includes("\n"))
            || column + compact.length > options.lineWidth;
          const attributeIndent = lineIndent(depth + 1, options);
          const formattedOpening = multiline
            ? `${prefix}\n${attributeIndent}${formattedAttributes
              .map((attribute) => indentContinuations(attribute, attributeIndent))
              .join(`\n${attributeIndent}`)}\n${lineIndent(depth, options)}${ending}`
            : compact;
          replace(node.start, openingEnd, formattedOpening, true);
        }

        const fragment = node.fragment as Fragment | undefined;
        const closeStart = closingTagStart(normalized, node, openingEnd);
        const fragmentBoundary = closeStart ?? node.end;
        if (fragment && fragmentBoundary > openingEnd) {
          const structuralChild = fragmentWillBeMultiline(fragment, depth + 1);
          const authoredMultiline = normalized.slice(openingEnd, fragmentBoundary).includes("\n");
          normalizeFragment(fragment, openingEnd, fragmentBoundary, depth,
            structuralChild || authoredMultiline, closeStart === undefined);
          visitFragment(fragment, depth + 1);
        }
        return;
      }

      if (node.type === "ConstTag") {
        const declaration = isNode(node.declaration) ? node.declaration : undefined;
        if (declaration?.start !== undefined && declaration.end !== undefined) {
          const formatted = formatDeclaration(normalized, declaration, this.scripts, options, markupLanguage);
          replace(declaration.start, declaration.end,
            indentContinuations(formatted, lineIndent(depth, options)), true);
        }
        return;
      }

      if (node.type === "DebugTag") {
        const identifiers = Array.isArray(node.identifiers) ? node.identifiers.filter(isNode) : [];
        const first = identifiers[0];
        const last = identifiers[identifiers.length - 1];
        if (first?.start !== undefined && last?.end !== undefined) {
          const range: Node = { type: "DebugExpression", start: first.start, end: last.end };
          replace(first.start, last.end,
            formatExpression(normalized, range, this.scripts, options, markupLanguage), true);
        }
        return;
      }

      if (node.type.endsWith("Block")) {
        visitBlock(node, depth);
        return;
      }

      const fragment = node.fragment as Fragment | undefined;
      if (fragment) visitFragment(fragment, depth);
    };

    visitFragment(ast.fragment, 0);

    for (const expression of expressionNodes(ast.fragment)) {
      if (expression.start === undefined || expression.end === undefined) continue;
      if (claimed.some((range) => expression.start! >= range.start && expression.end! <= range.end)) continue;
      replace(expression.start, expression.end,
        formatExpression(normalized, expression, this.scripts, options, markupLanguage));
    }

    for (const script of [ast.module, ast.instance]) {
      if (!script) continue;
      const language = scriptLanguage(script);
      if (!language) continue;
      const original = normalized.slice(script.content.start, script.content.end);
      const code = dedent(original);
      if (!code.trim()) continue;
      const formatted = this.scripts.format(`${code}\n`, { ...options, language });
      replace(script.content.start, script.content.end, indentRegion(formatted, options.indent), true);
    }

    if (ast.css && isCssStyle(ast.css)) {
      const original = normalized.slice(ast.css.content.start, ast.css.content.end);
      const css = dedent(original);
      if (css.trim()) {
        const formatted = this.styles.format(`${css}\n`, { ...options, language: "css" });
        replace(ast.css.content.start, ast.css.content.end, indentRegion(formatted, options.indent), true);
      }
    }

    const ordered = replacements.sort((left, right) => right.start - left.start || right.end - left.end);
    for (let index = 0; index < ordered.length; index++) {
      const current = ordered[index];
      const next = ordered[index + 1];
      if (next && next.end > current.start) throw new Error("Overlapping Svelte formatting regions.");
    }

    let result = normalized;
    for (const replacement of ordered) {
      result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
    }
    return result.trimEnd() + "\n";
  }
}
