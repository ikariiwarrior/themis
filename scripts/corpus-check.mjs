import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import fg from "fast-glob";
import { format } from "../dist/index.js";

const root = resolve(process.argv[2] ?? ".");
const files = await fg("**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,svelte,css,json}", {
  cwd: root,
  absolute: true,
  onlyFiles: true,
  followSymbolicLinks: false,
  ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/coverage/**"],
});

let changed = 0;
const failures = [];

function mismatchMessage(once, twice) {
  let index = 0;
  while (index < once.length && index < twice.length && once[index] === twice[index]) index++;
  const line = once.slice(0, index).split("\n").length;
  const lineStart = once.lastIndexOf("\n", index - 1) + 1;
  const lineEnd = once.indexOf("\n", index);
  const secondLineEnd = twice.indexOf("\n", index);
  const before = once.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
  const after = twice.slice(lineStart, secondLineEnd < 0 ? undefined : secondLineEnd);
  const onceLines = once.split("\n").slice(Math.max(0, line - 3), line + 2).join("\n");
  const twiceLines = twice.split("\n").slice(Math.max(0, line - 3), line + 2).join("\n");
  return `output is not idempotent at line ${line}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}\nFirst pass:\n${onceLines}\nSecond pass:\n${twiceLines}`;
}

for (const path of files.sort()) {
  try {
    const source = await readFile(path, "utf8");
    const extension = path.match(/\.(json|css|svelte|jsx|tsx|(?:m|c)?js|(?:m|c)?ts)$/i)?.[1]?.toLowerCase();
    const language = extension === "json" ? "json" : extension === "css" ? "css" : extension === "svelte" ? "svelte" : extension === "tsx" ? "tsx" : extension === "jsx" ? "jsx" : extension?.endsWith("ts") ? "typescript" : "javascript";
    const once = format(source, { language });
    const twice = format(once, { language });
    if (once !== twice) throw new Error(mismatchMessage(once, twice));
    if (once !== source) changed++;
  } catch (error) {
    failures.push({ path, error });
  }
}

if (failures.length) {
  for (const failure of failures) {
    process.stderr.write(`${failure.path}: ${failure.error instanceof Error ? failure.error.message : String(failure.error)}\n`);
  }
  process.stderr.write(`Corpus check failed for ${failures.length} of ${files.length} files.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Corpus check passed: ${files.length} files parsed and formatted idempotently; ${changed} would change.\n`);
}
