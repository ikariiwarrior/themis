export type LanguageId = "javascript" | "typescript" | "jsx" | "tsx" | "svelte" | "css" | "json";
export type QuotePreference = "single" | "double";

export interface FormatOptions {
  language: LanguageId;
  lineWidth: number;
  indent: string;
  typescriptQuotePreference?: QuotePreference;
  respectObjectFormatting: boolean;
}

export interface ThemisConfig {
  lineWidth?: number;
  indent?: {
    type?: "spaces" | "tabs";
    size?: number;
  };
  typescriptQuotePreference?: QuotePreference;
  respectObjectFormatting?: boolean;
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
