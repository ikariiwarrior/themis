export type CliMode = "stdout" | "write" | "check" | "list-different";

export interface CliArguments {
  mode: CliMode;
  inputs: string[];
  configPath?: string;
  stdinFilePath?: string;
  cache: boolean;
  cacheLocation?: string;
  watch: boolean;
  help: boolean;
}

function takeValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

export function parseArgs(args: string[]): CliArguments {
  const result: CliArguments = { mode: "stdout", inputs: [], cache: false, watch: false, help: false };
  let selectedMode: CliMode | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") result.help = true;
    else if (arg === "--write" || arg === "--check" || arg === "--list-different") {
      const mode = arg.slice(2) as CliMode;
      if (selectedMode && selectedMode !== mode) throw new Error("Choose only one of --write, --check, or --list-different.");
      selectedMode = mode;
      result.mode = mode;
    } else if (arg === "--config") {
      result.configPath = takeValue(args, index, arg);
      index++;
    } else if (arg === "--stdin-file-path") {
      result.stdinFilePath = takeValue(args, index, arg);
      index++;
    } else if (arg === "--cache") {
      result.cache = true;
    } else if (arg === "--cache-location") {
      result.cache = true;
      result.cacheLocation = takeValue(args, index, arg);
      index++;
    } else if (arg === "--watch") {
      result.watch = true;
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else result.inputs.push(arg);
  }

  if (result.watch && result.mode !== "write") throw new Error("--watch requires --write.");
  if (result.cache && result.mode === "stdout") throw new Error("--cache requires --write, --check, or --list-different.");

  return result;
}

export const HELP = `themis [options] [files, directories, or globs...]

Options:
  --write                 Rewrite changed files atomically
  --check                 Exit 1 when any file would change
  --list-different        Print files that would change and exit 1
  --config <path>         Use an explicit themis.json file
  --stdin-file-path <p>   Select a language for stdin
  --cache                 Skip files already verified with this version/config
  --cache-location <p>    Store cache at a custom path (default .themis-cache)
  --watch                 Keep formatting changes; requires --write
  -h, --help              Show this help
`;
