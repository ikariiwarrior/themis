export type CliMode = "stdout" | "write" | "check" | "list-different";

export interface CliArguments {
  mode: CliMode;
  inputs: string[];
  configPath?: string;
  stdinFilePath?: string;
  help: boolean;
}

function takeValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

export function parseArgs(args: string[]): CliArguments {
  const result: CliArguments = { mode: "stdout", inputs: [], help: false };
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
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else result.inputs.push(arg);
  }

  return result;
}

export const HELP = `themis [options] [files, directories, or globs...]

Options:
  --write                 Rewrite changed files atomically
  --check                 Exit 1 when any file would change
  --list-different        Print files that would change and exit 1
  --config <path>         Use an explicit themis.json file
  --stdin-file-path <p>   Select a language for stdin
  -h, --help              Show this help
`;
