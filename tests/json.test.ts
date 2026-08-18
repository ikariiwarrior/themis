import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { format } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

async function golden(): Promise<[string, string]> {
  return Promise.all([
    readFile(join(here, "golden", "json.input.json"), "utf8"),
    readFile(join(here, "golden", "json.output.json"), "utf8").then((value) => value.replace(/\r\n?/g, "\n")),
  ]);
}

describe("JSON formatter", () => {
  it("matches the golden file and preserves scalar spellings", async () => {
    const [input, expected] = await golden();
    const output = format(input, { language: "json" });
    expect(output).toBe(expected);
    expect(output).toContain("\"unicode\": \"\\u0061\"");
    expect(output).toContain("\"number\": 1e3");
  });

  it("emits valid, idempotent strict JSON", async () => {
    const [input] = await golden();
    const once = format(input, { language: "json" });
    expect(() => JSON.parse(once)).not.toThrow();
    expect(format(once, { language: "json" })).toBe(once);
  });

  it("uses width only to expand arrays and never collapses intentional multiline arrays", () => {
    expect(format("[1,2,3]\n", { language: "json", lineWidth: 40 })).toBe("[ 1, 2, 3 ]\n");
    expect(format("[\n1,\n2\n]\n", { language: "json", lineWidth: 120 })).toBe("[\n    1,\n    2\n]\n");
    expect(format("[\"alpha\",\"beta\",\"gamma\"]\n", { language: "json", lineWidth: 20 })).toBe(
      "[\n    \"alpha\",\n    \"beta\",\n    \"gamma\"\n]\n",
    );
  });

  it("uses configured indentation", () => {
    expect(format("{\"value\":1}", { language: "json", indent: "\t" })).toBe("{\n\t\"value\": 1\n}\n");
  });

  it.each([
    ["comments", "{\"value\":1/* no */}"],
    ["trailing commas", "{\"value\":1,}"],
    ["single quotes", "{'value':1}"],
    ["unquoted keys", "{value:1}"],
    ["non-finite numbers", "{\"value\":NaN}"],
  ])("rejects %s", (_name, input) => {
    expect(() => format(input, { language: "json" })).toThrow("Invalid strict JSON");
  });
});
