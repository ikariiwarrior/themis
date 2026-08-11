import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "svelte/compiler";
import { describe, expect, it } from "vitest";
import { format } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

async function golden(): Promise<[string, string]> {
  return Promise.all([
    readFile(join(here, "golden", "svelte.input.svelte"), "utf8"),
    readFile(join(here, "golden", "svelte.output.svelte"), "utf8"),
  ]);
}

describe("Svelte formatter", () => {
  it("formats module, TypeScript, and CSS regions while preserving markup", async () => {
    const [input, expected] = await golden();
    const output = format(input, { language: "svelte" });
    expect(output).toBe(expected);
    expect(output).toContain("<svelte:head><title>Keep   this</title></svelte:head>");
    expect(output).toContain("class=\"px-2   py-1\" onclick={() => count+=1}>{count+1}");
    expect(output).toContain("        color: red;\n        padding: 0;");
  });

  it("emits valid, idempotent Svelte", async () => {
    const [input] = await golden();
    const once = format(input, { language: "svelte" });
    expect(() => parse(once, { modern: true })).not.toThrow();
    expect(format(once, { language: "svelte" })).toBe(once);
  });

  it("uses configured indentation at script boundaries", () => {
    const input = "<script lang=\"ts\">const x:number=1;</script>\n<p>{x}</p>\n";
    expect(format(input, { language: "svelte", indent: "\t" })).toBe(
      "<script lang=\"ts\">\n\tconst x: number = 1;\n</script>\n<p>{x}</p>\n",
    );
  });

  it("leaves explicitly unsupported script languages untouched", () => {
    const input = "<script lang=\"coffee\">const   x=1</script>\n<div>{x}</div>\n";
    expect(format(input, { language: "svelte" })).toBe(input);
  });

  it("formats explicit CSS and leaves other parseable style languages untouched", () => {
    const css = "<style lang=\"css\">.x{color:red}</style>\n";
    expect(format(css, { language: "svelte" })).toBe(
      "<style lang=\"css\">\n    .x {\n        color: red;\n    }\n</style>\n",
    );

    const unsupported = "<style lang=\"scss\">.x{color:red}</style>\n";
    expect(format(unsupported, { language: "svelte" })).toBe(unsupported);
  });
});
