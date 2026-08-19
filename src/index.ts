import { resolveOptions } from "./core/options.js";
import { FormatError, type FormatOptions } from "./core/types.js";
import { JavaScriptFormatter } from "./js/formatter.js";
import { SvelteFormatter } from "./svelte/formatter.js";
import { CssFormatter } from "./css/formatter.js";
import { JsonFormatter } from "./json/formatter.js";

export { resolveOptions, languageFromPath } from "./core/options.js";
export { loadConfig, optionsFromConfig, type LoadedConfig } from "./project/config.js";
export { discoverFiles } from "./project/files.js";

const javaScriptFormatter = new JavaScriptFormatter();
const cssFormatter = new CssFormatter();
const engines = [javaScriptFormatter, cssFormatter, new JsonFormatter(), new SvelteFormatter(javaScriptFormatter, cssFormatter)];

export function format(source: string, options: Partial<FormatOptions> = {}): string {
  const resolved = resolveOptions(options);
  const engine = engines.find((candidate) => candidate.languages.includes(resolved.language));
  if (!engine) throw new FormatError(`No formatter engine for ${resolved.language}`);

  try {
    return engine.format(source, resolved);
  } catch (error) {
    if (error instanceof FormatError) throw error;
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new FormatError(`Unable to parse source; input was left untouched.${detail}`, error);
  }
}

export type { FormatOptions, LanguageId, QuotePreference, ThemisConfig } from "./core/types.js";
