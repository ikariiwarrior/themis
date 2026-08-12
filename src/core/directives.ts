export type ThemisDirective = "ignore" | "ignore-start" | "ignore-end";

export interface SourceRange {
  start: number;
  end: number;
}

export function themisDirective(comment: string): ThemisDirective | undefined {
  let body = comment.trim();
  if (body.startsWith("//")) body = body.slice(2);
  else if (body.startsWith("/*") && body.endsWith("*/")) body = body.slice(2, -2);

  switch (body.trim()) {
    case "themis-ignore": return "ignore";
    case "themis-ignore-start": return "ignore-start";
    case "themis-ignore-end": return "ignore-end";
    default: return undefined;
  }
}

export function rangeContainsGap(range: SourceRange, start: number, end: number): boolean {
  return start >= range.start && end <= range.end;
}
