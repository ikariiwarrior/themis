#!/usr/bin/env node
import { stdin, stdout, stderr } from "node:process";
import { runCli } from "./cli/run.js";

async function main(): Promise<void> {
  process.exitCode = await runCli(process.argv.slice(2), { cwd: process.cwd(), stdin, stdout, stderr });
}

main().catch((error: unknown) => {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
