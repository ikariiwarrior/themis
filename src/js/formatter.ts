import type { FormatterEngine, FormatOptions, LanguageId } from "../core/types.js";
import { rangeContainsGap, themisDirective, type SourceRange } from "../core/directives.js";
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

const FUNCTION_BODY_PARENTS = new Set([
  "FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression",
  "ObjectMethod", "ClassMethod", "ClassPrivateMethod",
]);

const CLASS_FIELD_MEMBER_TYPES = new Set([
  "ClassProperty", "ClassPrivateProperty", "ClassAccessorProperty",
  "TSAbstractPropertyDefinition", "TSIndexSignature", "EmptyStatement",
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

function requoteString(raw: string, preferred: "'" | '"'): string {
  const current = raw[0];
  if ((current !== "'" && current !== '"') || raw.at(-1) !== current || current === preferred) return raw;

  let body = "";
  for (let index = 1; index < raw.length - 1; index++) {
    const character = raw[index];
    if (character === "\\" && index + 1 < raw.length - 1) {
      const escaped = raw[++index];
      body += escaped === current ? escaped : `\\${escaped}`;
    } else {
      body += character === preferred ? `\\${character}` : character;
    }
  }
  return `${preferred}${body}${preferred}`;
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

function protectedRanges(ast: Node, tokens: Token[], source: string): SourceRange[] {
  const nodes: SourceRange[] = [];
  walk(ast, undefined, (node) => {
    if (node.type !== "File" && node.type !== "Program" && node.start != null && node.end != null) {
      nodes.push({ start: node.start, end: node.end });
    }
  });

  const ranges: SourceRange[] = [];
  let regionStart: number | undefined;
  for (const token of tokens) {
    if (!isComment(token)) continue;
    const directive = themisDirective(source.slice(token.start, token.end));
    if (!directive) continue;

    if (directive === "ignore-start") {
      if (regionStart !== undefined) throw new Error("Nested themis-ignore-start directives are not allowed.");
      regionStart = token.end;
      continue;
    }

    if (directive === "ignore-end") {
      if (regionStart === undefined) throw new Error("themis-ignore-end has no matching themis-ignore-start.");
      ranges.push({ start: regionStart, end: token.start });
      regionStart = undefined;
      continue;
    }

    const candidates = nodes.filter((node) => node.start >= token.end);
    if (candidates.length === 0) throw new Error("themis-ignore must be followed by a syntax node.");
    const firstStart = Math.min(...candidates.map((node) => node.start));
    const first = candidates
      .filter((node) => node.start === firstStart)
      .sort((left, right) => right.end - left.end)[0];
    ranges.push({ start: token.end, end: first.end });
  }

  if (regionStart !== undefined) throw new Error("themis-ignore-start has no matching themis-ignore-end.");
  return ranges;
}

export class JavaScriptFormatter implements FormatterEngine {
  readonly languages: readonly LanguageId[] = ["javascript", "typescript", "jsx", "tsx"];

  format(source: string, options: FormatOptions): string {
    const normalized = source.replace(/\r\n?/g, "\n");
    const ast = parseJavaScript(normalized, options.language) as unknown as Node & { tokens?: Token[] };
    const tokens = (ast.tokens ?? []).filter((token) => label(token, normalized) !== "eof");
    if (tokens.length === 0) return normalized.endsWith("\n") ? normalized : `${normalized}\n`;

    const gaps = tokens.slice(1).map((token, index) => normalized.slice(tokens[index].end, token.start));
    const originalGaps = [...gaps];
    const ignoredRanges = protectedRanges(ast, tokens, normalized);
    const forcedBreak = new Map<number, number>();
    const forcedBlank = new Map<number, number>();
    const multilineObjects = new Set<number>();
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
    const objectPropertyTokens = new Map<number, number[]>();
    const jsxElementRanges: SourceRange[] = [];
    const multilineParenthesizedRanges: SourceRange[] = [];
    const jsxDelimiterTokens = new Set<number>();
    const tokenOverrides = new Map<number, string>();
    const programStatementTokens = new Set<number>();
    const expandedArrays = new Set<number>();
    const expandedCalls = new Set<number>();
    const arrayRanges: Array<{ open: number; close: number; elements: Node[] }> = [];
    const stringLiteralTokens = new Set<number>();
    const mixedQuoteVariableRanges: SourceRange[] = [];
    const callRanges: Array<{
      start: number;
      end: number;
      open: number;
      close: number;
      args: Node[];
      authoredMultiline: boolean;
    }> = [];

    const tokenText = (index: number): string => normalized.slice(tokens[index].start, tokens[index].end);
    const tokenIs = (index: number, text: string): boolean => label(tokens[index], normalized) === text;
    const breakWasAuthoredBefore = (index: number): boolean => index > 0 && containsLineBreak(originalGaps[index - 1] ?? "");
    const blankWasAuthoredBefore = (currentToken: number): boolean =>
      currentToken > 0 && (originalGaps[currentToken - 1]?.match(/\n/g) ?? []).length > 1;
    const forceStructuralBreak = (tokenIndex: number, extra = 0): void => {
      (blankWasAuthoredBefore(tokenIndex) ? forcedBlank : forcedBreak).set(tokenIndex, extra);
    };
    const isInterfaceDeclaration = (node: Node): boolean => node.type === "TSInterfaceDeclaration"
      || (node.type === "ExportNamedDeclaration" && (node.declaration as Node | undefined)?.type === "TSInterfaceDeclaration");
    const attachInterfaceSemicolon = (previous: Node, current: Node, currentToken: number): boolean => {
      if (current.type !== "EmptyStatement" || !isInterfaceDeclaration(previous) || !tokenIs(currentToken, ";")) return false;
      if (currentToken > 0) gaps[currentToken - 1] = "";
      return true;
    };

    const formatMultilineDelimitedList = (
      open: number,
      close: number,
      items: Node[],
      expand: boolean,
      itemExtra = 1,
    ): void => {
      if (!expand || close <= open + 1) return;
      const firstItem = items[0]?.start != null ? locate(tokens, items[0].start) : undefined;
      forceStructuralBreak(firstItem ?? open + 1, itemExtra);
      for (const item of items.slice(1)) {
        if (item.start == null) continue;
        const itemToken = locate(tokens, item.start);
        if (itemToken !== undefined) forceStructuralBreak(itemToken, itemExtra);
      }
      forcedBreak.set(close, 0);
    };

    const forceMultilineObject = (open: number, close: number): void => {
      multilineObjects.add(open);
      forcedBreak.set(open + 1, 0);
      forcedBreak.set(close, 0);
      for (const propertyToken of objectPropertyTokens.get(open) ?? []) forceStructuralBreak(propertyToken);
      let nestedDepth = 0;
      for (let index = open + 1; index < close; index++) {
        if (["(", "[", "{", "${"].some((text) => tokenIs(index, text))) nestedDepth++;
        if ([")", "]", "}"].some((text) => tokenIs(index, text))) nestedDepth--;
        if (tokenIs(index, ",") && nestedDepth === 0) forceStructuralBreak(index + 1);
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
            const authoredGap = gaps[colon] ?? "";
            if (!options.respectObjectFormatting || !/^[\t ]{2,}$/.test(authoredGap)) spacedAfter.add(colon);
          }
        }
      }

      if (node.type === "StringLiteral" && node.start != null) {
        const tokenIndex = locate(tokens, node.start);
        if (tokenIndex !== undefined && parent?.type !== "JSXAttribute") stringLiteralTokens.add(tokenIndex);
      }

      if (node.type === "VariableDeclarator" && node.start != null && node.end != null) {
        const quotes = new Set<string>();
        walk(node, parent, (descendant) => {
          if (descendant.type !== "StringLiteral" || descendant.start == null || descendant.end == null) return;
          const raw = normalized.slice(descendant.start, descendant.end);
          if (raw[0] === "'" || raw[0] === '"') quotes.add(raw[0]);
        });
        if (quotes.size > 1) mixedQuoteVariableRanges.push({ start: node.start, end: node.end });
      }

      if ((node.type === "ConditionalExpression" || node.type === "TSConditionalType") && node.start != null && node.end != null) {
        const question = findToken(tokens, node.start, node.end, "?", normalized);
        const colon = findToken(tokens, node.start, node.end, ":", normalized, true);
        for (const tokenIndex of [question, colon]) {
          if (tokenIndex !== undefined) {
            spacedBefore.add(tokenIndex);
            spacedAfter.add(tokenIndex);
            if (node.type === "ConditionalExpression" && breakWasAuthoredBefore(tokenIndex)) forcedBreak.set(tokenIndex, 1);
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

      if ((node.type === "JSXExpressionContainer" || node.type === "JSXSpreadAttribute" || node.type === "JSXSpreadChild") && node.start != null && node.end != null) {
        const open = locate(tokens, node.start);
        const close = locate(tokens, node.end, true);
        if (open !== undefined && close !== undefined && close > open + 1) {
          compactAfter.add(open);
          compactBefore.add(close);
        }
      }

      if (node.type === "JSXAttribute" && node.start != null && node.end != null) {
        const equals = findToken(tokens, node.start, node.end, "=", normalized);
        if (equals !== undefined) {
          compactBefore.add(equals);
          compactAfter.add(equals);
        }
      }

      if (node.type === "JSXOpeningElement" && node.start != null && node.end != null) {
        const attributes = Array.isArray(node.attributes) ? node.attributes as Node[] : [];
        const open = locate(tokens, node.start);
        const close = locate(tokens, node.end, true);
        const name = node.name as Node | undefined;
        if (open !== undefined) {
          jsxDelimiterTokens.add(open);
          compactAfter.add(open);
        }
        if (close !== undefined) {
          jsxDelimiterTokens.add(close);
          compactBefore.add(close);
        }
        if (close !== undefined && name?.end != null && attributes.length > 0) {
          const firstAttribute = locate(tokens, attributes[0].start ?? -1);
          const authoredMultiline = containsLineBreak(normalized.slice(node.start, node.end));
          const expand = authoredMultiline || normalized.slice(node.start, node.end).length > options.lineWidth;
          if (firstAttribute !== undefined) {
            if (expand) {
              const baseContinuation =
                multilineParenthesizedRanges.filter((range) => range.start < node.start! && node.start! < range.end).length +
                jsxElementRanges.filter((range) => range.start < node.start! && node.start! < range.end).length;
              for (const attribute of attributes) {
                if (attribute.start == null) continue;
                const attributeToken = locate(tokens, attribute.start);
                if (attributeToken !== undefined) forcedBreak.set(attributeToken, baseContinuation + 1);
              }
              const closingToken = tokenText(close - 1) === "/" ? close - 1 : close;
              forcedBreak.set(closingToken, baseContinuation);
            } else {
              spacedBefore.add(firstAttribute);
            }
          }
          if (tokenText(close - 1) === "/") {
            jsxDelimiterTokens.add(close - 1);
            spacedBefore.add(close - 1);
            compactAfter.add(close - 1);
          }
        }
      }

      if (node.type === "JSXClosingElement" && node.start != null && node.end != null) {
        const open = locate(tokens, node.start);
        const close = locate(tokens, node.end, true);
        if (open !== undefined) {
          jsxDelimiterTokens.add(open);
          compactBefore.add(open);
          compactAfter.add(open);
          if (tokenText(open + 1) === "/") {
            jsxDelimiterTokens.add(open + 1);
            compactAfter.add(open + 1);
          }
        }
        if (close !== undefined) {
          jsxDelimiterTokens.add(close);
          compactBefore.add(close);
        }
      }

      if ((node.type === "JSXOpeningFragment" || node.type === "JSXClosingFragment") && node.start != null && node.end != null) {
        const open = locate(tokens, node.start);
        const close = locate(tokens, node.end, true);
        const slash = findToken(tokens, node.start, node.end, "/", normalized);
        if (open !== undefined) {
          jsxDelimiterTokens.add(open);
          compactBefore.add(open);
          compactAfter.add(open);
        }
        if (close !== undefined) {
          jsxDelimiterTokens.add(close);
          compactBefore.add(close);
        }
        if (slash !== undefined) {
          jsxDelimiterTokens.add(slash);
          compactBefore.add(slash);
          compactAfter.add(slash);
        }
      }

      if ((node.type === "JSXElement" || node.type === "JSXFragment") && node.start != null && node.end != null) {
        jsxElementRanges.push({ start: node.start, end: node.end });
      }

      if (node.type === "ParenthesizedExpression" && node.start != null && node.end != null && containsLineBreak(normalized.slice(node.start, node.end))) {
        const expression = node.expression as Node | undefined;
        const open = locate(tokens, node.start);
        const close = locate(tokens, node.end, true);
        if (expression?.start != null && open !== undefined && close !== undefined) {
          const expressionToken = locate(tokens, expression.start);
          if (expressionToken !== undefined && breakWasAuthoredBefore(expressionToken)) {
            multilineParenthesizedRanges.push({ start: node.start, end: node.end });
            forcedBreak.set(expressionToken, 1);
          }
          if (breakWasAuthoredBefore(close)) forcedBreak.set(close, 0);
        }
      }

      if (node.start != null && node.end != null && (
        node.type === "CallExpression" || node.type === "NewExpression" ||
        node.type === "FunctionDeclaration" || node.type === "FunctionExpression" ||
        node.type === "ObjectMethod" || node.type === "ClassMethod" || node.type === "ClassPrivateMethod" || node.type === "TSDeclareMethod" ||
        CONTROL_TYPES.has(node.type)
      )) {
        const callee = node.callee as Node | undefined;
        const searchStart = (node.type === "CallExpression" || node.type === "NewExpression") && callee?.end != null ? callee.end : node.start;
        const open = findToken(tokens, searchStart, node.end, "(", normalized);
        if (open !== undefined) attachedParens.add(open);
      }

      if ((parent?.type === "CallExpression" || parent?.type === "NewExpression") && Array.isArray(parent.arguments)) {
        if ((parent.arguments as unknown[]).includes(node) && node.type === "ObjectExpression") directArgumentObjects.add(node);
      }

      if ((node.type === "BlockStatement" || node.type === "TSModuleBlock") && node.start != null && node.end != null) {
        const body = Array.isArray(node.body) ? node.body as Node[] : [];
        const open = locate(tokens, node.start);
        const close = findToken(tokens, node.start, node.end, "}", normalized, true);
        if (open !== undefined && open >= 0 && close !== undefined && close >= 0) {
          blockBraces.set(open, close);
          if (close > open + 1) {
            const inlineFlowBody = node.type === "BlockStatement"
              && (options.language === "typescript" || options.language === "tsx")
              && parent !== undefined
              && (CONTROL_TYPES.has(parent.type) || FUNCTION_BODY_PARENTS.has(parent.type))
              && (open === 0 || !containsLineBreak(gaps[open - 1] ?? ""));
            const soleReturn = body.length === 1 && body[0].type === "ReturnStatement";
            if (inlineFlowBody && !soleReturn) forcedBlank.set(open + 1, 0);
            else forceStructuralBreak(open + 1);
            forceStructuralBreak(close);
          }
        }

        for (let index = 1; index < body.length; index++) {
          const previous = body[index - 1];
          const statement = body[index];
          if (statement.start == null) continue;
          const tokenIndex = locate(tokens, statement.start);
          if (tokenIndex === undefined || tokenIndex < 0) continue;
          if (attachInterfaceSemicolon(previous, statement, tokenIndex)) continue;
          const isConcludingReturn = node.type === "BlockStatement"
            && statement.type === "ReturnStatement"
            && index === body.length - 1;
          const preserveAuthoredBlank = blankWasAuthoredBefore(tokenIndex);
          (isConcludingReturn || preserveAuthoredBlank ? forcedBlank : forcedBreak).set(tokenIndex, 0);
        }
      }

      if ((node.type === "ClassBody" || node.type === "TSInterfaceBody" || node.type === "TSTypeLiteral") && node.start != null && node.end != null) {
        const open = locate(tokens, node.start);
        const close = findToken(tokens, node.start, node.end, "}", normalized, true);
        if (open !== undefined && open >= 0 && close !== undefined && close >= 0) {
          blockBraces.set(open, close);
          const body = Array.isArray(node.body)
            ? node.body as Node[]
            : Array.isArray(node.members) ? node.members as Node[] : [];
          if (close > open + 1) {
            forceStructuralBreak(open + 1);
            forceStructuralBreak(close);
          }
          for (let index = 1; index < body.length; index++) {
            const previous = body[index - 1];
            const member = body[index];
            if (member.start == null) continue;
            const declarationToken = locate(tokens, member.start);
            let memberToken = declarationToken;
            if (node.type === "ClassBody" && previous.end != null) {
              const leadingComments = Array.isArray(member.leadingComments) ? member.leadingComments as Node[] : [];
              const leadingComment = leadingComments.find((comment) => comment.start != null
                && comment.start >= previous.end!
                && containsLineBreak(normalized.slice(previous.end!, comment.start)));
              if (leadingComment?.start != null) memberToken = locate(tokens, leadingComment.start);
            }
            if (memberToken === undefined || memberToken < 0) continue;
            const needsExecutableBoundary = node.type === "ClassBody"
              && (!CLASS_FIELD_MEMBER_TYPES.has(previous.type) || !CLASS_FIELD_MEMBER_TYPES.has(member.type));
            if (needsExecutableBoundary) forcedBlank.set(memberToken, 0);
            else forceStructuralBreak(memberToken);
            if (declarationToken !== undefined && declarationToken !== memberToken) forcedBreak.set(declarationToken, 0);
          }
        }
      }

      if (node.type === "ObjectExpression" && node.start != null && node.end != null) {
        const open = locate(tokens, node.start);
        const close = locate(tokens, node.end, true);
        if (open === undefined || open < 0 || close === undefined || close < 0 || close <= open + 1) return;
        const properties = Array.isArray(node.properties) ? node.properties as Node[] : [];
        objectPropertyTokens.set(open, properties.flatMap((property) => {
          if (property.start == null) return [];
          const tokenIndex = locate(tokens, property.start);
          return tokenIndex === undefined || tokenIndex < 0 ? [] : [tokenIndex];
        }));
        const wasMultiline = containsLineBreak(normalized.slice(node.start, node.end));
        if (wasMultiline || (!options.respectObjectFormatting
          && !compactArgumentObjectTrees.has(node)
          && !directArgumentObjects.has(node))) {
          forceMultilineObject(open, close);
        } else if (compactArgumentObjectTrees.has(node)) {
          compactArgumentObjectRanges.push({ open, close });
        }

        for (let index = 1; index < properties.length; index++) {
          const previous = properties[index - 1];
          const property = properties[index];
          if (previous.end == null || property.start == null) continue;
          const commentToken = tokens.findIndex((token) => token.start >= previous.end!
            && token.end <= property.start!
            && isComment(token));
          if (commentToken >= 0) {
            forcedBlank.set(commentToken, 0);
            const propertyToken = locate(tokens, property.start);
            if (propertyToken !== undefined) forcedBreak.set(propertyToken, 0);
          }
        }
      }

      if ((node.type === "CallExpression" || node.type === "NewExpression") && node.start != null && node.end != null) {
        const callee = node.callee as Node | undefined;
        const open = findToken(tokens, callee?.end ?? node.start, node.end, "(", normalized);
        const close = locate(tokens, node.end, true);
        const start = locate(tokens, node.start);
        if (start !== undefined && open !== undefined && close !== undefined && close > open + 1) {
          callRanges.push({
            start,
            end: close,
            open,
            close,
            args: Array.isArray(node.arguments) ? node.arguments as Node[] : [],
            authoredMultiline: containsLineBreak(normalized.slice(node.start, node.end)),
          });
        }
      }

      if (node.type === "ArrayExpression" && node.start != null && node.end != null) {
        const open = locate(tokens, node.start);
        const close = locate(tokens, node.end, true);
        const elements = Array.isArray(node.elements) ? (node.elements as Array<Node | null>).filter((item): item is Node => item !== null) : [];
        if (open !== undefined && close !== undefined && containsLineBreak(normalized.slice(node.start, node.end))) {
          expandedArrays.add(open);
          formatMultilineDelimitedList(open, close, elements, true, 0);
        }
        if (open !== undefined && close !== undefined) arrayRanges.push({ open, close, elements });
      }

      if (node.type === "ConditionalExpression") {
        for (const branch of [node.consequent, node.alternate] as Array<Node | undefined>) {
          if (branch?.start == null) continue;
          const branchToken = locate(tokens, branch.start);
          if (branchToken !== undefined && breakWasAuthoredBefore(branchToken)) forcedBreak.set(branchToken, 1);
        }
      }

      if (node.type === "ArrowFunctionExpression") {
        const body = node.body as Node | undefined;
        if (body?.start != null) {
          const bodyToken = locate(tokens, body.start);
          if (bodyToken !== undefined && breakWasAuthoredBefore(bodyToken)) forcedBreak.set(bodyToken, 1);
        }
      }

      if ((node.type === "MemberExpression" || node.type === "OptionalMemberExpression") && node.property && typeof node.property === "object") {
        const property = node.property as Node;
        if (property.start != null) {
          const propertyToken = locate(tokens, property.start);
          if (propertyToken !== undefined && propertyToken > 0 && breakWasAuthoredBefore(propertyToken - 1)) {
            forcedBreak.set(propertyToken - 1, 1);
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
        for (const statement of body) {
          if (statement.start == null) continue;
          const tokenIndex = locate(tokens, statement.start);
          if (tokenIndex !== undefined && tokenIndex >= 0) programStatementTokens.add(tokenIndex);
        }
        for (let index = 1; index < body.length; index++) {
          const current = body[index];
          if (current.start == null) continue;
          const tokenIndex = locate(tokens, current.start);
          if (tokenIndex === undefined || tokenIndex < 0) continue;
          if (attachInterfaceSemicolon(body[index - 1], current, tokenIndex)) continue;
          (blankWasAuthoredBefore(tokenIndex) ? forcedBlank : forcedBreak).set(tokenIndex, 0);
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

    if (options.typescriptQuotePreference) {
      const preferred = options.typescriptQuotePreference === "single" ? "'" : '"';
      for (const tokenIndex of stringLiteralTokens) {
        const token = tokens[tokenIndex];
        if (mixedQuoteVariableRanges.some((range) => range.start <= token.start && token.end <= range.end)) continue;
        tokenOverrides.set(tokenIndex, requoteString(tokenText(tokenIndex), preferred));
      }
    }

    // Expansion discovered inside an array must pressure its containing array
    // during this pass. Process inner arrays first so nested lists reach their
    // stable shape without requiring a second formatter run.
    for (const { open, close, elements } of arrayRanges.sort((left, right) =>
      (left.close - left.open) - (right.close - right.open)
    )) {
      const containsForcedBreak = [...forcedBreak.keys()].some((tokenIndex) => tokenIndex > open && tokenIndex < close);
      if (containsForcedBreak) {
        expandedArrays.add(open);
        formatMultilineDelimitedList(open, close, elements, true, 0);
      }
    }

    // Universal typography rules operate only on trivia between parser tokens.
    // Token spellings, comments, literals, and unsupported syntax are never regenerated.
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      const text = normalized.slice(token.start, token.end);
      if (isComment(token)) continue;

      if (tokenIs(index, "(") && index > 0 && attachedParens.has(index) && !containsLineBreak(gaps[index - 1])) gaps[index - 1] = "";

      if (tokenIs(index, ",")) {
        if (index > 0 && !containsLineBreak(gaps[index - 1])) gaps[index - 1] = "";
        if (index < gaps.length && !containsLineBreak(gaps[index])) gaps[index] = " ";
      }

      if (!jsxDelimiterTokens.has(index) && label(token, normalized) !== "template" && (ASSIGNMENT_OPERATORS.has(text) || BINARY_OPERATORS.has(text))) {
        if (index > 0 && !containsLineBreak(gaps[index - 1])) gaps[index - 1] = " ";
        if (index < gaps.length && !containsLineBreak(gaps[index])) gaps[index] = " ";
      }

      if (tokenIs(index, "{") && index > 0 && blockBraces.has(index) && !containsLineBreak(gaps[index - 1])) gaps[index - 1] = " ";
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

    const parenStack: number[] = [];
    const bracketStack: number[] = [];
    for (let index = 0; index < tokens.length; index++) {
      if (tokenIs(index, "(")) parenStack.push(index);
      if (tokenIs(index, ")")) {
        const open = parenStack.pop();
        if (open !== undefined && index > open + 1) {
          if (!containsLineBreak(gaps[open] ?? "")) gaps[open] = " ";
          if (!containsLineBreak(gaps[index - 1] ?? "")) gaps[index - 1] = " ";
        }
      }
      if (tokenIs(index, "[")) bracketStack.push(index);
      if (tokenIs(index, "]")) {
        const open = bracketStack.pop();
        if (open !== undefined && index > open + 1) {
          if (!containsLineBreak(gaps[open] ?? "")) gaps[open] = " ";
          if (!containsLineBreak(gaps[index - 1] ?? "")) gaps[index - 1] = " ";
        }
      }
    }

    // Width pressure is based on the prospective formatted token span, not the
    // raw source slice. Otherwise spaces inserted above can push a call past the
    // limit only after the first pass and make it expand on the second.
    const formattedRangeLength = (start: number, end: number): number => {
      let length = 0;
      for (let index = start; index <= end; index++) {
        length += tokenText(index).length;
        if (index < end) length += gaps[index]?.length ?? 0;
      }
      return length;
    };
    for (const call of callRanges) {
      if (!call.authoredMultiline && formattedRangeLength(call.start, call.end) <= options.lineWidth) continue;
      const expand = !call.authoredMultiline || breakWasAuthoredBefore(call.open + 1) || call.args.some((argument) => {
        if (argument.start == null) return false;
        const argumentToken = locate(tokens, argument.start);
        return argumentToken !== undefined && breakWasAuthoredBefore(argumentToken);
      }) || breakWasAuthoredBefore(call.close);
      if (expand) {
        expandedCalls.add(call.open);
        formatMultilineDelimitedList(call.open, call.close, call.args, true, 0);
      }
    }

    // Compute lexical brace depth for indentation introduced by this formatter.
    const braceDepth: number[] = [];
    const delimiterDepth: number[] = [];
    let braces = 0;
    let delimiters = 0;
    for (let index = 0; index < tokens.length; index++) {
      if (tokenIs(index, "}")) braces = Math.max(0, braces - 1);
      if (tokenIs(index, ")") || tokenIs(index, "]")) delimiters = Math.max(0, delimiters - 1);
      braceDepth[index] = braces;
      delimiterDepth[index] = delimiters;
      // Babel tokenizes a template interpolation as `${` ... `}`. Treat its
      // opening token as a brace so the closing `}` cannot accidentally reduce
      // the surrounding block's indentation depth.
      if (tokenIs(index, "{") || tokenIs(index, "${")) braces++;
      if (tokenIs(index, "(") || tokenIs(index, "[")) delimiters++;
    }

    const arrayContinuationDepth = (tokenIndex: number): number => arrayRanges.filter((range) =>
      expandedArrays.has(range.open) && range.open < tokenIndex && tokenIndex < range.close
    ).length;
    const callContinuationDepth = (tokenIndex: number): number => callRanges.filter((range) =>
      expandedCalls.has(range.open) && range.open < tokenIndex && tokenIndex < range.close
    ).length;
    const continuationDepth = (tokenIndex: number): number =>
      arrayContinuationDepth(tokenIndex) + callContinuationDepth(tokenIndex);

    // Program statements and standalone comments use computed indentation
    // instead of padding inherited from the input. Comments nested in objects
    // include surrounding array continuation depth, while comments that occur
    // directly inside calls retain their authored continuation layout.
    let leadingTrivia = normalized.slice(0, tokens[0].start);
    const normalizeLineIndent = (value: string, indent: string): string => {
      if (/^[\t ]*$/.test(value)) return indent;
      return containsLineBreak(value)
        ? value.replace(/[\t ]+(?=\n)/g, "").replace(/[\t ]*$/, indent)
        : value;
    };
    for (let index = 0; index < tokens.length; index++) {
      const commentStartsLine = index === 0 || breakWasAuthoredBefore(index)
        || forcedBreak.has(index) || forcedBlank.has(index);
      const indentableComment = isComment(tokens[index]) && commentStartsLine
        && (braceDepth[index] > 0 || delimiterDepth[index] === 0);
      if (!programStatementTokens.has(index) && !indentableComment) continue;
      const depth = programStatementTokens.has(index) ? 0 : braceDepth[index] + continuationDepth(index);
      const indent = options.indent.repeat(depth);
      if (index === 0) leadingTrivia = normalizeLineIndent(leadingTrivia, indent);
      else gaps[index - 1] = normalizeLineIndent(gaps[index - 1], indent);
      if (indentableComment && containsLineBreak(tokenText(index))) {
        const lineStart = normalized.lastIndexOf("\n", tokens[index].start - 1) + 1;
        const baseline = normalized.slice(lineStart, tokens[index].start);
        if (/^[\t ]+$/.test(baseline)) {
          const lines = tokenText(index).split("\n");
          tokenOverrides.set(index, [
            lines[0],
            ...lines.slice(1).map((line) => indent + (line.startsWith(baseline) ? line.slice(baseline.length) : line)),
          ].join("\n"));
        }
      }
    }

    // JSX line-edge whitespace is layout rather than authored content. Normalize
    // indentation around it while retaining text content and internal spacing.
    for (let index = 0; index < tokens.length; index++) {
      if (label(tokens[index], normalized) !== "jsxText") continue;
      const text = tokenText(index);
      if (!containsLineBreak(text)) continue;
      const nextIsClosingTag = tokenText(index + 1) === "<" && tokenText(index + 2) === "/";
      const nesting = jsxElementRanges.filter((range) => range.start < tokens[index].start && tokens[index].end < range.end).length;
      const parenthesized = multilineParenthesizedRanges.filter((range) => range.start < tokens[index].start && tokens[index].end < range.end).length;
      const childDepth = Math.max(0, braceDepth[index] + parenthesized + nesting);
      const nextDepth = Math.max(0, childDepth - (nextIsClosingTag ? 1 : 0));
      if (text.trim() === "") {
        tokenOverrides.set(index, `\n${options.indent.repeat(nextDepth)}`);
      } else if (/^[^\S\r\n]*\n/.test(text) && /\n[^\S\r\n]*$/.test(text)) {
        tokenOverrides.set(index, `\n${options.indent.repeat(childDepth)}${text.trim()}\n${options.indent.repeat(nextDepth)}`);
      }
    }

    for (const [tokenIndex, extra] of forcedBreak) {
      if (tokenIndex <= 0) continue;
      const indentDepth = Math.max(0, braceDepth[tokenIndex] + continuationDepth(tokenIndex) + extra);
      gaps[tokenIndex - 1] = `\n${options.indent.repeat(indentDepth)}`;
    }
    for (const [tokenIndex, extra] of forcedBlank) {
      if (tokenIndex <= 0) continue;
      const indentDepth = Math.max(0, braceDepth[tokenIndex] + continuationDepth(tokenIndex) + extra);
      gaps[tokenIndex - 1] = `\n\n${options.indent.repeat(indentDepth)}`;
    }

    for (let index = 0; index < gaps.length; index++) {
      const gapStart = tokens[index].end;
      const gapEnd = tokens[index + 1].start;
      if (ignoredRanges.some((range) => rangeContainsGap(range, gapStart, gapEnd))) gaps[index] = originalGaps[index];
    }

    for (const [index] of tokenOverrides) {
      if (ignoredRanges.some((range) => range.start <= tokens[index].start && tokens[index].end <= range.end)) {
        tokenOverrides.delete(index);
      }
    }

    let result = leadingTrivia + (tokenOverrides.get(0) ?? normalized.slice(tokens[0].start, tokens[0].end));
    for (let index = 1; index < tokens.length; index++) {
      result += gaps[index - 1] + (tokenOverrides.get(index) ?? normalized.slice(tokens[index].start, tokens[index].end));
    }
    result += normalized.slice(tokens[tokens.length - 1].end);
    return result.trimEnd() + "\n";
  }
}
