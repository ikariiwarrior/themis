export type LanguageId = "javascript" | "typescript" | "jsx" | "tsx" | "svelte" | "css" | "json";

export interface FormatOptions {
  language: LanguageId;
  lineWidth: number;
  indent: string;
}

export interface ThemisConfig {
  lineWidth?: number;
  indent?: {
    type?: "spaces" | "tabs";
    size?: number;
  };
  ignore?: string[];
}

export interface FormatterEngine {
  readonly languages: readonly LanguageId[];
  format(source: string, options: FormatOptions): string;
}

export class FormatError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "FormatError";
  }
}
