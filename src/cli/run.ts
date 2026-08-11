import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type { Writable, Readable } from "node:stream";
import { format } from "../index.js";
import { languageFromPath } from "../core/options.js";
import { loadConfig, optionsFromConfig } from "../project/config.js";
import { discoverFiles } from "../project/files.js";
import { atomicWrite } from "../project/write.js";
import { HELP, parseArgs } from "./args.js";

export interface CliEnvironment {
  cwd: string;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
}

async function readStdin(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function displayPath(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/") || path;
}

export async function runCli(argv: string[], environment: CliEnvironment): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    environment.stdout.write(HELP);
    return 0;
  }

  const loaded = await loadConfig(environment.cwd, args.configPath);
  const projectOptions = optionsFromConfig(loaded.config);

  if (args.inputs.length === 0) {
    if (args.mode !== "stdout") throw new Error(`${args.mode === "write" ? "--write" : `--${args.mode}`} requires at least one file, directory, or glob.`);
    const source = await readStdin(environment.stdin);
    const path = args.stdinFilePath ?? "stdin.ts";
    environment.stdout.write(format(source, { ...projectOptions, language: languageFromPath(path) }));
    return 0;
  }

  const files = await discoverFiles(args.inputs, environment.cwd, loaded.config.ignore, loaded.root);
  if (files.length === 0) throw new Error("No supported JavaScript, TypeScript, Svelte, CSS, or JSON files matched the input.");
  if (args.mode === "stdout" && files.length !== 1) throw new Error("Multiple files require --write, --check, or --list-different.");

  const formatted: Array<{ path: string; output: string; changed: boolean }> = [];
  const failures: Array<{ path: string; error: unknown }> = [];
  for (const path of files) {
    try {
      const source = await readFile(path, "utf8");
      const output = format(source, { ...projectOptions, language: languageFromPath(path) });
      formatted.push({ path, output, changed: output !== source });
    } catch (error) {
      failures.push({ path, error });
    }
  }

  if (failures.length) {
    for (const failure of failures) {
      environment.stderr.write(`${displayPath(loaded.root, failure.path)}: ${failure.error instanceof Error ? failure.error.message : String(failure.error)}\n`);
    }
    environment.stderr.write(`No files were written because ${failures.length} file${failures.length === 1 ? "" : "s"} failed.\n`);
    return 2;
  }

  const changed = formatted.filter((file) => file.changed);
  if (args.mode === "stdout") {
    environment.stdout.write(formatted[0].output);
    return 0;
  }
  if (args.mode === "write") {
    for (const file of changed) await atomicWrite(file.path, file.output);
    environment.stdout.write(`Formatted ${changed.length} file${changed.length === 1 ? "" : "s"}; ${files.length - changed.length} unchanged.\n`);
    return 0;
  }

  if (args.mode === "list-different") {
    for (const file of changed) environment.stdout.write(`${displayPath(loaded.root, file.path)}\n`);
  } else if (changed.length) {
    environment.stderr.write(`${changed.length} file${changed.length === 1 ? "" : "s"} would be reformatted.\n`);
  }
  return changed.length ? 1 : 0;
}
