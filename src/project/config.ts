import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { FormatOptions, ThemisConfig } from "../core/types.js";

export interface LoadedConfig {
  path?: string;
  root: string;
  config: ThemisConfig;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function validate(config: unknown, path: string): ThemisConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${path} must contain a JSON object.`);
  }

  const value = config as Record<string, unknown>;
  const known = new Set(["lineWidth", "indent", "ignore"]);
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length) throw new Error(`${path} contains unknown option${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);

  if (value.lineWidth !== undefined && (!Number.isInteger(value.lineWidth) || (value.lineWidth as number) < 20)) {
    throw new Error(`${path}: lineWidth must be an integer of at least 20.`);
  }

  if (value.indent !== undefined) {
    if (!value.indent || typeof value.indent !== "object" || Array.isArray(value.indent)) {
      throw new Error(`${path}: indent must be an object.`);
    }
    const indent = value.indent as Record<string, unknown>;
    const indentUnknown = Object.keys(indent).filter((key) => key !== "type" && key !== "size");
    if (indentUnknown.length) throw new Error(`${path}: indent contains unknown option${indentUnknown.length === 1 ? "" : "s"}: ${indentUnknown.join(", ")}.`);
    if (indent.type !== undefined && indent.type !== "spaces" && indent.type !== "tabs") {
      throw new Error(`${path}: indent.type must be "spaces" or "tabs".`);
    }
    if (indent.size !== undefined && (!Number.isInteger(indent.size) || (indent.size as number) < 1 || (indent.size as number) > 16)) {
      throw new Error(`${path}: indent.size must be an integer from 1 through 16.`);
    }
  }

  if (value.ignore !== undefined && (!Array.isArray(value.ignore) || value.ignore.some((item) => typeof item !== "string"))) {
    throw new Error(`${path}: ignore must be an array of strings.`);
  }

  return value as ThemisConfig;
}

export async function loadConfig(cwd: string, explicitPath?: string): Promise<LoadedConfig> {
  if (explicitPath) {
    const path = resolve(cwd, explicitPath);
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return { path, root: dirname(path), config: validate(parsed, path) };
  }

  let directory = resolve(cwd);
  while (true) {
    for (const filename of ["themis.json", "opinion.json"]) {
      const candidate = join(directory, filename);
      if (await exists(candidate)) {
        const parsed = JSON.parse(await readFile(candidate, "utf8")) as unknown;
        return { path: candidate, root: directory, config: validate(parsed, candidate) };
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return { root: resolve(cwd), config: {} };
}

export function optionsFromConfig(config: ThemisConfig): Partial<FormatOptions> {
  const indentType = config.indent?.type ?? "spaces";
  const indentSize = config.indent?.size ?? 4;
  return {
    lineWidth: config.lineWidth,
    indent: indentType === "tabs" ? "\t" : " ".repeat(indentSize),
  };
}
