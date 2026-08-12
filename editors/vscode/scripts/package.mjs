import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const executable = fileURLToPath(new URL("node_modules/@vscode/vsce/vsce", root));
const output = fileURLToPath(new URL(`dist/themis-vscode-${manifest.version}.vsix`, root));
const result = spawnSync(process.execPath, [executable, "package", "--out", output], { stdio: "inherit" });

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
