import { readFile } from "node:fs/promises";

const root = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const rootLock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const extension = JSON.parse(await readFile(new URL("../editors/vscode/package.json", import.meta.url), "utf8"));
const extensionLock = JSON.parse(await readFile(new URL("../editors/vscode/package-lock.json", import.meta.url), "utf8"));
const reference = process.argv[2] ?? process.env.GITHUB_REF_NAME;
const tag = reference?.startsWith("v") ? reference : undefined;

const versions = new Map([
  ["npm package", root.version],
  ["npm lockfile", rootLock.version],
  ["npm lockfile root", rootLock.packages?.[""]?.version],
  ["VS Code package", extension.version],
  ["VS Code lockfile", extensionLock.version],
  ["VS Code lockfile root", extensionLock.packages?.[""]?.version],
  ["VS Code bundled engine", extensionLock.packages?.["../.."]?.version],
]);
const mismatches = [...versions].filter(([, version]) => version !== root.version);
if (mismatches.length) {
  throw new Error(`Release versions differ from ${root.version}: ${mismatches.map(([name, version]) => `${name} ${String(version)}`).join(", ")}.`);
}

if (tag && tag !== `v${root.version}`) {
  throw new Error(`Release tag ${tag} does not match package version v${root.version}.`);
}

process.stdout.write(`Themis release ${root.version} is internally consistent${tag ? ` with ${tag}` : ""}.\n`);
