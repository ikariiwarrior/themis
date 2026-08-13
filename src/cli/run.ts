import { watch as watchFileSystem } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve as resolvePath } from "node:path";
import type { Writable, Readable } from "node:stream";
import { format } from "../index.js";
import { languageFromPath } from "../core/options.js";
import { loadFormatCache } from "../project/cache.js";
import { loadConfig, optionsFromConfig } from "../project/config.js";
import { discoverFiles } from "../project/files.js";
import { atomicWrite } from "../project/write.js";
import { HELP, parseArgs, type CliArguments } from "./args.js";

export interface CliEnvironment {
  cwd: string;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  signal?: AbortSignal;
}

interface RunResult {
  code: number;
  root: string;
}

async function readStdin(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function displayPath(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/") || path;
}

async function runFiles(args: CliArguments, environment: CliEnvironment): Promise<RunResult> {
  const loaded = await loadConfig(environment.cwd, args.configPath);
  const projectOptions = optionsFromConfig(loaded.config);

  if (args.inputs.length === 0) {
    if (args.mode !== "stdout") throw new Error(`${args.mode === "write" ? "--write" : `--${args.mode}`} requires at least one file, directory, or glob.`);
    const source = await readStdin(environment.stdin);
    const path = args.stdinFilePath ?? "stdin.ts";
    environment.stdout.write(format(source, { ...projectOptions, language: languageFromPath(path) }));
    return { code: 0, root: loaded.root };
  }

  const cachePath = args.cache ? resolvePath(loaded.root, args.cacheLocation ?? ".themis-cache") : undefined;
  const files = (await discoverFiles(args.inputs, environment.cwd, loaded.config.ignore, loaded.root))
    .filter((path) => path !== cachePath);
  if (files.length === 0) throw new Error("No supported JavaScript, TypeScript, Svelte, CSS, or JSON files matched the input.");
  if (args.mode === "stdout" && files.length !== 1) throw new Error("Multiple files require --write, --check, or --list-different.");

  const cache = args.cache ? await loadFormatCache(loaded.root, args.cacheLocation, projectOptions) : undefined;
  const formatted: Array<{ path: string; output: string; changed: boolean }> = [];
  const failures: Array<{ path: string; error: unknown }> = [];
  let cached = 0;
  for (const path of files) {
    try {
      const source = await readFile(path, "utf8");
      if (cache?.has(path, source)) {
        cached++;
        continue;
      }
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
    return { code: 2, root: loaded.root };
  }

  const changed = formatted.filter((file) => file.changed);
  if (args.mode === "stdout") {
    environment.stdout.write(formatted[0].output);
    return { code: 0, root: loaded.root };
  }
  if (args.mode === "write") {
    for (const file of changed) await atomicWrite(file.path, file.output);
    for (const file of formatted) cache?.mark(file.path, file.output);
    await cache?.save();
    const cachedText = cached ? `; ${cached} cached` : "";
    environment.stdout.write(`Formatted ${changed.length} file${changed.length === 1 ? "" : "s"}; ${files.length - changed.length - cached} unchanged${cachedText}.\n`);
    return { code: 0, root: loaded.root };
  }

  for (const file of formatted.filter((file) => !file.changed)) cache?.mark(file.path, file.output);
  await cache?.save();
  if (args.mode === "list-different") {
    for (const file of changed) environment.stdout.write(`${displayPath(loaded.root, file.path)}\n`);
  } else if (changed.length) {
    environment.stderr.write(`${changed.length} file${changed.length === 1 ? "" : "s"} would be reformatted.\n`);
  }
  return { code: changed.length ? 1 : 0, root: loaded.root };
}

async function runWatch(args: CliArguments, environment: CliEnvironment): Promise<number> {
  let first: RunResult;
  try {
    first = await runFiles(args, environment);
  } catch (error) {
    environment.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    const loaded = await loadConfig(environment.cwd, args.configPath);
    first = { code: 2, root: loaded.root };
  }

  environment.stdout.write(`Watching ${displayPath(environment.cwd, first.root)} for Themis-supported files.\n`);
  const controlNames = new Set(["themis.json", "opinion.json", ".gitignore", ".themisignore", ".opinionignore"]);
  const cacheRelative = relative(first.root, resolvePath(first.root, args.cacheLocation ?? ".themis-cache")).replaceAll("\\", "/");
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let queued = false;

  const run = async (): Promise<void> => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      await runFiles(args, environment);
    } catch (error) {
      environment.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    } finally {
      running = false;
      if (queued) {
        queued = false;
        schedule();
      }
    }
  };
  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), 75);
  }

  const watcher = watchFileSystem(first.root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const portable = filename.toString().replaceAll("\\", "/");
    const name = portable.split("/").at(-1) ?? portable;
    if (portable === cacheRelative || /(?:^|\/)(?:node_modules|\.git|dist|build|coverage)(?:\/|$)/.test(portable)) return;
    if (!/\.(?:js|mjs|cjs|jsx|ts|mts|cts|tsx|svelte|css|json)$/i.test(portable) && !controlNames.has(name)) return;
    schedule();
  });

  await new Promise<void>((resolve) => {
    if (environment.signal?.aborted) return resolve();
    environment.signal?.addEventListener("abort", () => resolve(), { once: true });
  });
  if (timer) clearTimeout(timer);
  watcher.close();
  return 0;
}

export async function runCli(argv: string[], environment: CliEnvironment): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    environment.stdout.write(HELP);
    return 0;
  }
  if (args.watch) return runWatch(args, environment);
  return (await runFiles(args, environment)).code;
}
