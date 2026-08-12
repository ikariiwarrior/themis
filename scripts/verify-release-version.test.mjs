import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./verify-release-version.mjs", import.meta.url));
const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

function verify(reference) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_REF_NAME: reference },
  });
}

test("accepts ordinary GitHub branch references", () => {
  const result = verify("main");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /internally consistent/);
});

test("accepts a matching release tag", () => {
  assert.equal(verify(`v${packageVersion}`).status, 0);
});

test("rejects a mismatched release tag", () => {
  const result = verify("v9.9.9");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match/);
});
