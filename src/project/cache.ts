import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { FormatOptions } from "../core/types.js";
import { atomicWrite } from "./write.js";

interface CacheFile {
  schema: 1;
  formatterVersion: string;
  options: string;
  entries: Record<string, string>;
}

export interface FormatCache {
  has(path: string, source: string): boolean;
  mark(path: string, source: string): void;
  save(): Promise<void>;
}

function hash(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

async function formatterVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string") throw new Error("Unable to determine the Themis package version.");
  return manifest.version;
}

export async function loadFormatCache(root: string, location: string | undefined, options: Partial<FormatOptions>): Promise<FormatCache> {
  const path = resolve(root, location ?? ".themis-cache");
  const version = await formatterVersion();
  const optionSignature = JSON.stringify(options);
  let entries: Record<string, string> = {};

  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<CacheFile>;
    if (parsed.schema === 1 && parsed.formatterVersion === version && parsed.options === optionSignature && parsed.entries && typeof parsed.entries === "object") {
      entries = parsed.entries;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }

  return {
    has(filePath, source) {
      return entries[resolve(filePath)] === hash(source);
    },
    mark(filePath, source) {
      entries[resolve(filePath)] = hash(source);
    },
    async save() {
      const value: CacheFile = { schema: 1, formatterVersion: version, options: optionSignature, entries };
      await mkdir(dirname(path), { recursive: true });
      await atomicWrite(path, `${JSON.stringify(value)}\n`, 0o600);
    },
  };
}
