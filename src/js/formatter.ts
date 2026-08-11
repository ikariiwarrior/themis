import type { FormatterEngine, FormatOptions, LanguageId } from "../core/types.js";
import { parseJavaScript } from "./parser.js";

type Node = {
  type: string;
  start?: number | null;
  end?: number | null;
  [key: string]: unknown;
};

type Token = {
  start: number;
  end: number;
  type: { label?: string } | string;
};

const ASSIGNMENT_OPERATORS = new Set([
  "=", "+=", "-=", "*=", "/=", "%=", "**=", "&&=", "||=", "??=", "<<=", ">>=", ">>>=", "&=", "|=", "^=",
]);

const BINARY_OPERATORS = new Set([
  "+", "-", "*", "/", "%", "**", "==", "!=", "===", "!==", "<", ">", "<=", ">=", "<<", ">>", ">>>",
  "&", "|", "^", "&&", "||", "??", "in", "instanceof", "=>", "|>",
]);

const CONTROL_TYPES = new Set([
  "IfStatement", "ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement",
  "SwitchStatement", "TryStatement", "CatchClause", "WithStatement",
]);

function children(node: Node): Node[] {
  const result: Node[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "range", "tokens", "comments", "errors", "extra"].includes(key)) continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item === "object" && "type" in item) result.push(item as Node);
    } else if (value && typeof value === "object" && "type" in value) {
      result.push(value as Node);
    }
  }
  return result;
}

function walk(node: Node, parent: Node | undefined, visit: (node: Node, parent?: Node) => void): void {
  visit(node, parent);
  for (const child of children(node)) walk(child, node, visit);
}

function label(token: Token, source: string): string {
  return typeof token.type === "string" ? token.type : token.type.label ?? source.slice(token.start, token.end);
}

function isComment(token: Token): boolean {
  const value = typeof token.type === "string" ? token.type : token.type.label ?? "";
  return value.startsWith("Comment") || value === undefined;
}

function containsLineBreak(text: string): boolean {
  return /\r?\n/.test(text);
}

function locate(tokens: Token[], position: number, fromEnd = false): number | undefined {
  return tokens.findIndex((token) => (fromEnd ? token.end === position : token.start === position));
}

function findToken(tokens: Token[], start: number, end: number, text: string, source: string, reverse = false): number | undefined {
  if (reverse) {
    for (let index = tokens.length - 1; index >= 0; index--) {
      const token = tokens[index];
      if (token.start >= start && token.end <= end && source.slice(token.start, token.end) === text) return index;
    }
  } else {
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token.start >= start && token.end <= end && source.slice(token.start, token.end) === text) return index;
    }
  }
  return undefined;
}

export class JavaScriptFormatter implements FormatterEngine {
  readonly languages: readonly LanguageId[] = ["javascript", "typescript", "jsx", "tsx"];

  format(source: string, options: FormatOptions): string {
    const normalized = source.replace(/\r\n?/g, "\n");
    const ast = parseJavaScript(normalized, options.language) as unknown as Node & { tokens?: Token[] };
    const tokens = (ast.tokens ?? []).filter((token) => label(token, normalized) !== "eof");
    if (tokens.length === 0) return normalized.endsWith("\n") ? normalized : `${normalized}\n`;

    const gaps = tokens.slice(1).map((token, index) => normalized.slice(tokens[index].end, token.start));
    const forcedBreak = new Map<number, number>();
    const forcedBlank = new Map<number, number>();
    const multilineObjects = new Set<number>();
    const multilineCalls = new Set<number>();
    const blockBraces = new Map<number, number>();
    const attachedParens = new Set<number>();
    const genericAngles: Array<{ open: number; close: number }> = [];
    const compactBefore = new Set<number>();
    const compactAfter = new Set<number>();
    const spacedBefore = new Set<number>();
    const spacedAfter = new Set<number>();
    const directArgumentObjects = new Set<Node>();
    const compactArgumentObjectTrees = new Set<Node>();
    const compactArgumentObjectRanges: Array<{ open: number; close: number }> = [];

    const forceMultilineObject = (open: number, close: number): void => {
      multilineObjects.add(open);
      forcedBreak.set(open + 1, 0);
      forcedBreak.set(close, 0);
      let nestedDepth = 0;
      for (let index = open + 1; index < close; index++) {
        const tokenText = normalized.slice(tokens[index].start, tokens[index].end);
        if (["(", "[", "{"].includes(tokenText)) nestedDepth++;
        if ([")", "]", "}"].includes(tokenText)) nestedDepth--;
        if (tokenText === "," && nestedDepth === 0) forcedBreak.set(index + 1, 0);
      }
    };

    walk(ast, undefined, (node, parent) => {
      if ((node.type === "CallExpression" || node.type === "NewExpression") && Array.isArray(node.arguments)) {
        for (const argument of node.arguments as Node[]) {
          if (argument.type !== "ObjectExpression" || argument.start == null || argument.end == null) continue;
          directArgumentObjects.add(argument);
          if (!containsLineBreak(normalized.slice(argument.start, argument.end))) {
            walk(argument, node, (descendant) => {
              if (descendant.type === "ObjectExpression") compactArgumentObjectTrees.add(descendant);
            });
          }
        }
      }

      if (node.type === "TSTypeAnnotation" && node.start != null && node.end != null) {
        const colon = findToken(tokens, node.start, node.end, ":", normalized);
        if (colon !== undefined) {
          compactBefore.add(colon);
          spacedAfter.add(colon);
        }
      }

      if (node.type === "ObjectProperty" && !node.shorthand) {
        const key = node.key as Node | undefined;
        const value = node.value as Node | undefined;
        if (key?.end != null && value?.start != null) {
          const colon = findToken(tokens, key.end, value.start, ":", normalized);
          if (colon !== undefined) {
            compactBefore.add(colon);
            spacedAfter.add(colon);
          }
        }
      }

      if ((node.type === "ConditionalExpression" || node.type === "TSConditionalType") && node.start != null && node.end != null) {
        const question = findToken(tokens, node.start, node.end, "?", normalized);
        const colon = findToken(tokens, node.start, node.end, ":", normalized, true);
        for (const tokenIndex of [question, colon]) {
          if (tokenIndex !== undefined) {
            spacedBefore.add(tokenIndex);
            spacedAfter.add(tokenIndex);
          }
        }
      }

      if (node.optional === true && node.start != null && node.end != null) {
        const question = findToken(tokens, node.start, node.end, "?", normalized);
        if (question !== undefined) {
          compactBefore.add(question);
          compactAfter.add(question);
        }
      }

      if ((node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") && node.start != null && node.end != null) {
        const keyword = findToken(tokens, node.start, node.end, node.type === "TSAsExpression" ? "as" : "satisfies", normalized);
        if (keyword !== undefined) {
          spacedBefore.add(keyword);
          spacedAfter.add(keyword);
        }
      }

      if (node.type === "TSTypeOperator" && node.start != null && node.end != null) {
        for (const keywordText of ["keyof", "readonly", "unique"]) {
          const keyword = findToken(tokens, node.start, node.end, keywordText, normalized);
          if (keyword !== undefined) spacedAfter.add(keyword);
        }
      }

      if (node.type === "TSTypeParameter" && node.start != null && node.end != null) {
        const keyword = findToken(tokens, node.start, node.end, "extends", normalized);
        if (keyword !== undefined) {
          spacedBefore.add(keyword);
          spacedAfter.add(keyword);
        }
      }

      if ((node.type === "ClassDeclaration" || node.type === "ClassExpression" || node.type === "TSInterfaceDeclaration") && node.start != null && node.end != null) {
        for (const keywordText of ["extends", "implements"]) {
          const keyword = findToken(tokens, node.start, node.end, keywordText, normalized);
          if (keyword !== undefined) {
            spacedBefore.add(keyword);
            spacedAfter.add(keyword);
          }
        }
      }

      if ((node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.start != null && node.end != null) {
        const leadingKeyword = findToken(tokens, node.start, node.end, node.type === "ImportDeclaration" ? "import" : "export", normalized);
        if (leadingKeyword !== undefined) spacedAfter.add(leadingKeyword);

        const fromKeyword = findToken(tokens, node.start, node.end, "from", normalized);
        if (fromKeyword !== undefined) {
          spacedBefore.add(fromKeyword);
          spacedAfter.add(fromKeyword);
        }

        const open = findToken(tokens, node.start, node.end, "{", normalized);
        const close = findToken(tokens, node.start, node.end, "}", normalized, true);
        if (open !== undefined && close !== undefined && close > open + 1) {
          spacedAfter.add(open);
          spacedBefore.add(close);
        }
      }

      if ((node.type === "ImportSpecifier" || node.type === "ExportSpecifier") && node.start != null && node.end != null) {
        const typeKeyword = findToken(tokens, node.start, node.end, "type", normalized);
        if (typeKeyword !== undefined) spacedAfter.add(typeKeyword);
        const asKeyword = findToken(tokens, node.start, node.end, "as", normalized);
        if (asKeyword !== undefined) {
          spacedBefore.add(asKeyword);
          spacedAfter.add(asKeyword);
        }
      }

      if ((node.type === "TSTypeParameterInstantiation" || node.type === "TSTypeParameterDeclaration") && node.start != null && node.end != null) {
        const open = findToken(tokens, node.start, node.end, "<", normalized);
        const close = findToken(tokens, node.start, node.end, ">", normalized, true);
        if (open !== undefined && close !== undefined && close > open) genericAngles.push({ open, close });
      }

      if (node.start != null && node.end != null && (
        node.type === "CallExpression" || node.type === "NewExpression" ||
        node.type === "FunctionDeclaration" || node.type === "FunctionExpression" ||
        node.type === "ObjectMethod" || node.type === "ClassMethod" || node.type === "ClassPrivateMethod" || node.type === "TSDeclareMethod" ||
        CONTROL_TYPES.has(node.type)
      )) {
        const open = findToken(tokens, node.start, node.end, "(", normalized);
        if (open !== undefined) attachedParens.add(open);
      }

      if ((parent?.type === "CallExpression" || parent?.type === "NewExpression") && Array.isArray(parent.arguments)) {
        if ((parent.arguments as unknown[]).includes(node) && node.type === "ObjectExpression") directArgumentObjects.add(node);
      }

      if (node.type === "BlockStatement" && node.start != null && node.end != null) {
        const open = locate(tokens, node.start);
        const close = locate(tokens, node.end, true);
        if (open !== undefined && open >= 0 && close !== undefined && close >= 0) {
          blockBraces.set(open, close);
          if (close > open + 1) {
            forcedBreak.set(open + 1, 0);
            forcedBreak.set(close, 0);
          }
        }

        const body = Array.isArray(node.body) ? node.body as Node[] : [];
        for (let index = 1; index < body.length; index++) {
          const statement = body[index];
          if (statement.start == null) continue;
          const tokenIndex = locate(tokens, statement.start);
          if (tokenIndex === undefined || tokenIndex < 0) continue;
          const isConcludingReturn = statement.type === "ReturnStatement" && index === body.length - 1;
          (isConcludingReturn ? forcedBlank : forcedBreak).set(tokenIndex, 0);
        }
      }

      if ((node.type === "ClassBody" || node.type === "TSInterfaceBody") && node.start != null && node.end != null) {
        const open = locate(tokens, node.start);
        const close = locate(tokens, node.end, true);
        if (open !== undefined && open >= 0 && close !== undefined && close >= 0) {
          blockBraces.set(open, close);
          const body = Array.isArray(node.body) ? node.body as Node[] : [];
          if (close > open + 1) {
            forcedBreak.set(open + 1, 0);
            forcedBreak.set(close, 0);
          }
          for (let index = 1; index < body.length; index++) {
            const member = body[index];
            if (member.start == null) continue;
            const memberToken = locate(tokens, member.start);
            if (memberToken !== undefined && memberToken >= 0) forcedBreak.set(memberToken, 0);
          }
        }
      }

      if (node.type === "ObjectExpression" && node.start != null && node.end != null) {
        const open = locate(tokens, node.start);
        const close = locate(tokens, node.end, true);
        if (open === undefined || open < 0 || close === undefined || close < 0 || close <= open + 1) return;
        const wasMultiline = containsLineBreak(normalized.slice(node.start, node.end));
        if (!compactArgumentObjectTrees.has(node) && (!directArgumentObjects.has(node) || wasMultiline)) {
          forceMultilineObject(open, close);
        } else if (compactArgumentObjectTrees.has(node)) {
          compactArgumentObjectRanges.push({ open, close });
        }
      }

      if ((node.type === "CallExpression" || node.type === "NewExpression") && node.start != null && node.end != null) {
        const text = normalized.slice(node.start, node.end);
        if (!containsLineBreak(text) && text.length > options.lineWidth) {
          const open = findToken(tokens, node.start, node.end, "(", normalized);
          const close = findToken(tokens, node.start, node.end, ")", normalized, true);
          if (open !== undefined && close !== undefined && close > open + 1) {
            multilineCalls.add(open);
            forcedBreak.set(open + 1, 1);
            forcedBreak.set(close, 0);
            let depth = 0;
            for (let index = open + 1; index < close; index++) {
              const text = normalized.slice(tokens[index].start, tokens[index].end);
              if (["(", "[", "{"].includes(text)) depth++;
              if ([")", "]", "}"].includes(text)) depth--;
              if (text === "," && depth === 0) forcedBreak.set(index + 1, 1);
            }
          }
        }
      }

      if (CONTROL_TYPES.has(node.type) && node.start != null && node.end != null) {
        const block = children(node).find((child) => child.type === "BlockStatement");
        if (block?.start != null) {
          const brace = locate(tokens, block.start);
          if (brace !== undefined && brace > 0) gaps[brace - 1] = " ";
        }
      }

      if (node.type === "Program") {
        const body = Array.isArray(node.body) ? node.body as Node[] : [];
        for (let index = 1; index < body.length; index++) {
          const current = body[index];
          if (current.start == null) continue;
          const tokenIndex = locate(tokens, current.start);
          if (tokenIndex === undefined || tokenIndex < 0) continue;
          const structural = CONTROL_TYPES.has(current.type) || /(?:Declaration|Statement)$/.test(current.type);
          (structural ? forcedBlank : forcedBreak).set(tokenIndex, 0);
        }
      }
    });

    // If a compact direct-argument object contains a construct that must become
    // multiline (for example, an object method body), expand the object in the
    // same pass instead of discovering that fact on the second pass.
    for (const { open, close } of compactArgumentObjectRanges.sort((left, right) => left.close - left.open - (right.close - right.open))) {
      const containsForcedBreak = [...forcedBreak.keys()].some((tokenIndex) => tokenIndex > open && tokenIndex < close);
      if (containsForcedBreak) forceMultilineObject(open, close);
    }

    // Universal typography rules operate only on trivia between parser tokens.
    // Token spellings, comments, literals, and unsupported syntax are never regenerated.
    const parenStack: number[] = [];
    const bracketStack: number[] = [];
    const parenDepth: number[] = [];
    let depth = 0;
    for (let index = 0; index < tokens.length; index++) {
      const text = normalized.slice(tokens[index].start, tokens[index].end);
      parenDepth[index] = depth;
      if (text === "(") { parenStack.push(index); depth++; }
      if (text === ")") {
        depth--;
        const open = parenStack.pop();
        if (open !== undefined && index > open + 1 && !multilineCalls.has(open)) {
          if (!containsLineBreak(gaps[open] ?? "")) gaps[open] = " ";
          if (!containsLineBreak(gaps[index - 1] ?? "")) gaps[index - 1] = " ";
        }
      }
      if (text === "[") bracketStack.push(index);
      if (text === "]") {
        const open = bracketStack.pop();
        if (open !== undefined && index > open + 1) {
          if (!containsLineBreak(gaps[open] ?? "")) gaps[open] = " ";
          if (!containsLineBreak(gaps[index - 1] ?? "")) gaps[index - 1] = " ";
        }
      }
    }

    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      const text = normalized.slice(token.start, token.end);
      if (isComment(token)) continue;

      if (text === "(" && index > 0 && attachedParens.has(index) && !containsLineBreak(gaps[index - 1])) gaps[index - 1] = "";

      if (text === ",") {
        if (index > 0 && !containsLineBreak(gaps[index - 1])) gaps[index - 1] = "";
        if (index < gaps.length && !containsLineBreak(gaps[index])) gaps[index] = " ";
      }

      if (ASSIGNMENT_OPERATORS.has(text) || BINARY_OPERATORS.has(text)) {
        if (index > 0 && !containsLineBreak(gaps[index - 1])) gaps[index - 1] = " ";
        if (index < gaps.length && !containsLineBreak(gaps[index])) gaps[index] = " ";
      }

      if (text === "{" && index > 0 && blockBraces.has(index) && !containsLineBreak(gaps[index - 1])) gaps[index - 1] = " ";
    }

    // TypeScript generic delimiters are punctuation, not comparison operators.
    // Apply this after operator spacing so syntax context wins over token spelling.
    for (const { open, close } of genericAngles) {
      if (open > 0 && !containsLineBreak(gaps[open - 1])) gaps[open - 1] = "";
      if (open < gaps.length && !containsLineBreak(gaps[open])) gaps[open] = "";
      if (close > 0 && !containsLineBreak(gaps[close - 1])) gaps[close - 1] = "";
      const next = tokens[close + 1] ? normalized.slice(tokens[close + 1].start, tokens[close + 1].end) : undefined;
      if (next && [";", ",", ")", "]", ".", "?.", "(", "["].includes(next) && !containsLineBreak(gaps[close] ?? "")) {
        gaps[close] = "";
      }
    }


    // Contextual punctuation overrides are deliberately last: the AST meaning
    // of `:`, `?`, and type keywords outranks their raw token spelling.
    for (const tokenIndex of compactBefore) {
      if (tokenIndex > 0 && !containsLineBreak(gaps[tokenIndex - 1])) gaps[tokenIndex - 1] = "";
    }
    for (const tokenIndex of compactAfter) {
      if (tokenIndex < gaps.length && !containsLineBreak(gaps[tokenIndex])) gaps[tokenIndex] = "";
    }
    for (const tokenIndex of spacedBefore) {
      if (tokenIndex > 0 && !containsLineBreak(gaps[tokenIndex - 1])) gaps[tokenIndex - 1] = " ";
    }
    for (const tokenIndex of spacedAfter) {
      if (tokenIndex < gaps.length && !containsLineBreak(gaps[tokenIndex])) gaps[tokenIndex] = " ";
    }

    // Compute lexical brace depth for indentation introduced by this formatter.
    const braceDepth: number[] = [];
    let braces = 0;
    for (let index = 0; index < tokens.length; index++) {
      const text = normalized.slice(tokens[index].start, tokens[index].end);
      if (text === "}") braces = Math.max(0, braces - 1);
      braceDepth[index] = braces;
      if (text === "{") braces++;
    }

    for (const [tokenIndex, extra] of forcedBreak) {
      if (tokenIndex <= 0) continue;
      const indentDepth = Math.max(0, braceDepth[tokenIndex] + extra - (normalized.slice(tokens[tokenIndex].start, tokens[tokenIndex].end) === "}" ? 0 : 0));
      gaps[tokenIndex - 1] = `\n${options.indent.repeat(indentDepth)}`;
    }
    for (const [tokenIndex, extra] of forcedBlank) {
      if (tokenIndex <= 0) continue;
      const indentDepth = Math.max(0, braceDepth[tokenIndex] + extra);
      gaps[tokenIndex - 1] = `\n\n${options.indent.repeat(indentDepth)}`;
    }

    let result = normalized.slice(0, tokens[0].start) + normalized.slice(tokens[0].start, tokens[0].end);
    for (let index = 1; index < tokens.length; index++) {
      result += gaps[index - 1] + normalized.slice(tokens[index].start, tokens[index].end);
    }
    result += normalized.slice(tokens[tokens.length - 1].end);
    return result.trimEnd() + "\n";
  }
}
