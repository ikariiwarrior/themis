import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import fg from "fast-glob";
import createIgnore from "ignore";

const SUPPORTED_PATTERN = "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,svelte,css,json}";
const ALWAYS_IGNORED = ["node_modules/", ".git/", "dist/", "build/", "coverage/"];

async function kind(path: string): Promise<"file" | "directory" | undefined> {
  try {
    const info = await stat(path);
    if (info.isFile()) return "file";
    if (info.isDirectory()) return "directory";
  } catch {
    return undefined;
  }
}

async function optionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw error;
  }
}

export async function discoverFiles(
  inputs: string[],
  cwd: string,
  configuredIgnore: string[] = [],
  ignoreRoot = cwd,
): Promise<string[]> {
  const candidates = new Set<string>();
  for (const input of inputs) {
    const absolute = resolve(cwd, input);
    const inputKind = await kind(absolute);
    if (inputKind === "file") {
      candidates.add(absolute);
      continue;
    }
    if (inputKind === "directory") {
      const matches = await fg(SUPPORTED_PATTERN, { cwd: absolute, absolute: true, onlyFiles: true, dot: true, followSymbolicLinks: false });
      matches.forEach((path) => candidates.add(resolve(path)));
      continue;
    }

    const matches = await fg(input.replaceAll("\\", "/"), { cwd, absolute: true, onlyFiles: true, dot: true, followSymbolicLinks: false });
    matches.forEach((path) => candidates.add(resolve(path)));
  }

  const matcher = createIgnore().add(ALWAYS_IGNORED).add(configuredIgnore);
  for (const filename of [".gitignore", ".themisignore", ".opinionignore"]) {
    const contents = await optionalText(resolve(ignoreRoot, filename));
    if (contents) matcher.add(contents);
  }

  return [...candidates]
    .filter((path) => {
      const projectRelative = relative(ignoreRoot, path);
      if (projectRelative.startsWith("..") || isAbsolute(projectRelative)) return true;
      const portable = projectRelative.split(sep).join("/");
      return !matcher.ignores(portable);
    })
    .filter((path) => /\.(?:js|mjs|cjs|jsx|ts|mts|cts|tsx|svelte|css|json)$/i.test(path))
    .sort((left, right) => left.localeCompare(right));
}
