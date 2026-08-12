import { readFile } from "node:fs/promises";

const root = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const extension = JSON.parse(await readFile(new URL("../editors/vscode/package.json", import.meta.url), "utf8"));
const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];

if (root.version !== extension.version) {
  throw new Error(`Release versions differ: npm ${root.version}, VS Code ${extension.version}.`);
}

if (tag && tag !== `v${root.version}`) {
  throw new Error(`Release tag ${tag} does not match package version v${root.version}.`);
}

process.stdout.write(`Themis release ${root.version} is internally consistent${tag ? ` with ${tag}` : ""}.\n`);
