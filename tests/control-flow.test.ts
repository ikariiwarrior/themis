import { parse } from "@babel/parser";
import { parse as parseSvelte } from "svelte/compiler";
import { describe, expect, it } from "vitest";
import { format } from "../src/index.js";

const cases = {
  "unbraced multiline call": [
    "if( !result.success )",
    "  log.write.error(",
    "    'An error was encountered with the forgot password form.',",
    "    { ...get_request_context(), associated_error: errors.normalize( result.error ) }",
    "  );",
  ],
  "single statement block": [
    "if( status === response_code.conflict ) {",
    "  invalid( issue.email_address( 'An account with that email address already exists.' ) );",
    "}",
  ],
  "single multiline statement block": [
    "if( status === response_code.conflict ) {",
    "  invalid( issue.email_address(",
    "    'An account with that email address already exists.'",
    "  ) );",
    "}",
  ],
  "nested unbraced branches": [
    "if( ready )",
    "  if( valid )",
    "    write(",
    "      value",
    "    );",
    "  else if( retry )",
    "    write(",
    "      fallback",
    "    );",
    "  else",
    "    stop();",
    "done();",
  ],
  "unbraced loop": [
    "while( ready )",
    "  write(",
    "    value",
    "  );",
    "done();",
  ],
  "comment attached to concluding return": [
    "function submit() {",
    "",
    "  work();",
    "",
    "  // Always return success to avoid email enumeration",
    "  return( { result: true } );",
    "}",
  ],
  "consecutive return comments": [
    "function submit() {",
    "",
    "  work();",
    "",
    "  // First comment",
    "  // Second comment",
    "  return true;",
    "}",
  ],
};

describe("control flow layout", () => {
  for (const [name, lines] of Object.entries(cases)) {
    const expected = lines.join("\n") + "\n";
    const input = lines.filter(Boolean).map((line) => line.trimStart()).join("\n");
    for (const language of ["javascript", "typescript"] as const) {
      it(`${name} in ${language}`, () => {
        const options = { language, indent: "  ", respectObjectFormatting: true };
        const output = format(input, options);
        // JavaScript does not insert the TypeScript opening block padding.
        const target = language === "javascript" ? expected.replace("submit() {\n\n", "submit() {\n") : expected;
        expect(output).toBe(target);
        expect(() => parse(output, { sourceType: "module", plugins: ["typescript"] })).not.toThrow();
        expect(format(output, options)).toBe(output);
      });
    }
    it(`${name} in a Svelte script`, () => {
      const options = { language: "svelte" as const, indent: "  ", respectObjectFormatting: true };
      const output = format(`<script lang="ts">\n${input}\n</script>\n`, options);
      expect(output).toContain(expected.trimEnd().split("\n").map((line) => line ? `  ${line}` : "").join("\n"));
      expect(() => parseSvelte(output, { modern: true })).not.toThrow();
      expect(format(output, options)).toBe(output);
    });
  }

  it("preserves authored blanks and inline bodies", () => {
    const input = "if( ready ) {\n\n  work();\n}\nif( ready ) work();\n";
    expect(format(input, { language: "typescript", indent: "  " })).toBe(input);
  });

  it("keeps trailing comments on the preceding statement", () => {
    const input = "function submit() {\n\n  work(); // Work comment\n\n  return true;\n}\n";
    expect(format(input, { language: "typescript", indent: "  " })).toBe(input);
  });
});
