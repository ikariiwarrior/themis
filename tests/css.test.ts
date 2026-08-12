import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { format } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

async function golden(): Promise<[string, string]> {
  return Promise.all([
    readFile(join(here, "golden", "css.input.css"), "utf8"),
    readFile(join(here, "golden", "css.output.css"), "utf8"),
  ]);
}

describe("CSS formatter", () => {
  it("formats structural whitespace while preserving selectors and values", async () => {
    const [input, expected] = await golden();
    const output = format(input, { language: "css" });
    expect(output).toBe(expected);
    expect(output).toContain(".card,.panel");
    expect(output).toContain("linear-gradient(90deg,red,blue)");
    expect(output).toContain("@apply px-2 py-1;");
    expect(output).toContain("/* keep  exact */");
  });

  it("emits valid, idempotent CSS", async () => {
    const [input] = await golden();
    const once = format(input, { language: "css" });
    expect(() => postcss.parse(once)).not.toThrow();
    expect(format(once, { language: "css" })).toBe(once);
  });

  it("uses configured indentation", () => {
    expect(format("a{color:red}", { language: "css", indent: "\t" })).toBe("a {\n\tcolor: red;\n}\n");
  });

  it("rejects invalid CSS instead of delegating to another formatter", () => {
    expect(() => format("a { color: ;", { language: "css" })).toThrow();
  });

  it("preserves ignored CSS nodes and bounded regions", () => {
    const input = [
      ".formatted{color:red}",
      "/* themis-ignore */",
      ".legacy { color :red;padding:  0 }",
      "/* themis-ignore-start */",
      ".old{margin :0}",
      ".older {padding:0;color : blue}",
      "/* themis-ignore-end */",
      ".after{display:block}",
      "",
    ].join("\n");
    const output = format(input, { language: "css" });

    expect(output).toContain(".legacy { color :red;padding:  0 }");
    expect(output).toContain(".old{margin :0}\n.older {padding:0;color : blue}");
    expect(output).toContain(".formatted {");
    expect(output).toContain(".after {");
    expect(format(output, { language: "css" })).toBe(output);
  });

  it("rejects malformed CSS ignore directives", () => {
    expect(() => format("/* themis-ignore */\n", { language: "css" })).toThrow("must be followed");
    expect(() => format("/* themis-ignore-start */\na{x:1}\n", { language: "css" })).toThrow("no matching");
  });
});
