#!/usr/bin/env node
import { stdin, stdout, stderr } from "node:process";
import { runCli } from "./cli/run.js";

async function main(): Promise<void> {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  process.exitCode = await runCli(process.argv.slice(2), { cwd: process.cwd(), stdin, stdout, stderr, signal: controller.signal });
}

main().catch((error: unknown) => {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
