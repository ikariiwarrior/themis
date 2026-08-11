import { printParseErrorCode, parseTree, type Node, type ParseError } from "jsonc-parser";
import type { FormatterEngine, FormatOptions, LanguageId } from "../core/types.js";

interface PrintContext {
  source: string;
  options: FormatOptions;
}

function raw(node: Node, source: string): string {
  return source.slice(node.offset, node.offset + node.length);
}

function wasMultiline(node: Node, source: string): boolean {
  return /\r?\n/.test(raw(node, source));
}

function printProperty(node: Node, depth: number, context: PrintContext): string {
  const [key, value] = node.children ?? [];
  if (!key || !value) throw new Error("Invalid JSON property node.");
  return `${raw(key, context.source)}: ${printNode(value, depth, context)}`;
}

function printObject(node: Node, depth: number, context: PrintContext): string {
  const properties = node.children ?? [];
  if (properties.length === 0) return "{}";
  const childIndent = context.options.indent.repeat(depth + 1);
  const closeIndent = context.options.indent.repeat(depth);
  const body = properties.map((property) => `${childIndent}${printProperty(property, depth + 1, context)}`).join(",\n");
  return `{\n${body}\n${closeIndent}}`;
}

function printArray(node: Node, depth: number, context: PrintContext): string {
  const items = node.children ?? [];
  if (items.length === 0) return "[]";

  const flatItems = items.map((item) => printNode(item, depth + 1, context));
  const flat = `[ ${flatItems.join(", ")} ]`;
  const availableWidth = context.options.lineWidth - context.options.indent.repeat(depth).length;
  const multiline = wasMultiline(node, context.source) || flat.includes("\n") || flat.length > availableWidth;
  if (!multiline) return flat;

  const childIndent = context.options.indent.repeat(depth + 1);
  const closeIndent = context.options.indent.repeat(depth);
  return `[\n${flatItems.map((item) => `${childIndent}${item}`).join(",\n")}\n${closeIndent}]`;
}

function printNode(node: Node, depth: number, context: PrintContext): string {
  if (node.type === "object") return printObject(node, depth, context);
  if (node.type === "array") return printArray(node, depth, context);
  if (node.type === "property") return printProperty(node, depth, context);
  return raw(node, context.source);
}

function parseStrict(source: string): Node {
  const errors: ParseError[] = [];
  const tree = parseTree(source, errors, { allowTrailingComma: false, disallowComments: true, allowEmptyContent: false });
  if (!tree || errors.length) {
    const detail = errors[0] ? `${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}` : "empty input";
    throw new Error(`Invalid strict JSON: ${detail}.`);
  }
  return tree;
}

export class JsonFormatter implements FormatterEngine {
  readonly languages: readonly LanguageId[] = ["json"];

  format(source: string, options: FormatOptions): string {
    const normalized = source.replace(/\r\n?/g, "\n");
    const tree = parseStrict(normalized);
    return printNode(tree, 0, { source: normalized, options }).trimEnd() + "\n";
  }
}
