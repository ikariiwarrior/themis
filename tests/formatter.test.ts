import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";
import { format } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

async function golden(name: string): Promise<[string, string]> {
  return Promise.all([
    readFile(join(here, "golden", `${name}.input.ts`), "utf8"),
    readFile(join(here, "golden", `${name}.output.ts`), "utf8"),
  ]);
}

describe("JavaScript/TypeScript formatter", () => {
  for (const name of ["acceptance", "objects-and-return"]) {
    it(`matches the ${name} golden file`, async () => {
      const [input, expected] = await golden(name);
      expect(format(input, { language: "typescript" })).toBe(expected);
    });
  }

  it("emits syntactically valid output", async () => {
    for (const name of ["acceptance", "objects-and-return"]) {
      const [input] = await golden(name);
      const output = format(input, { language: "typescript" });
      expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
    }
  });

  it("is idempotent", async () => {
    for (const name of ["acceptance", "objects-and-return"]) {
      const [input] = await golden(name);
      const once = format(input, { language: "typescript" });
      expect(format(once, { language: "typescript" })).toBe(once);
    }
  });

  it("preserves comments, literals, optional chaining, and type syntax", () => {
    const input = "const value: Box<string>=source?.read(`a  b`/* keep  exact */);\n";
    const output = format(input, { language: "typescript" });
    expect(output).toContain("`a  b`");
    expect(output).toContain("/* keep  exact */");
    expect(output).toContain("source?.read( `a  b`");
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
  });

  it("preserves every explicit grouping parenthesis", () => {
    const output = format("const valid=(a&&b)||(c&&d);\n", { language: "typescript" });
    expect(output).toBe("const valid = ( a && b ) || ( c && d );\n");
  });

  it("does not add a blank line before a body containing only return", () => {
    expect(format("function identity(x){return x;}\n", { language: "typescript" })).toBe(
      "function identity( x ) {\n    return x;\n}\n",
    );
  });

  it("spaces non-empty square brackets without changing empty brackets", () => {
    expect(format("const first=values[0];const list=[1,2];const empty=[];\n", { language: "typescript" })).toBe(
      "const first = values[ 0 ];\n\nconst list = [ 1, 2 ];\n\nconst empty = [];\n",
    );
  });

  it("keeps TypeScript generic angle brackets compact", () => {
    const input = [
      "type Result<TValue,TError>=Map<TValue,Array<TError>>;",
      "function identity<T>(value:T){return value;}",
      "const result=identity<Result<string,Error>>(value);",
      "const compared=left<right&&right>minimum;",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript" });

    expect(output).toContain("Result<TValue, TError>");
    expect(output).toContain("Map<TValue, Array<TError>>");
    expect(output).toContain("identity<T>( value: T )");
    expect(output).toContain("identity<Result<string, Error>>( value )");
    expect(output).toContain("left < right && right > minimum");
    expect(format("type Wrapped=Box< MyType >;\n", { language: "typescript" })).toBe("type Wrapped = Box<MyType>;\n");
    expect(format(output, { language: "typescript" })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
  });

  it("formats TypeScript punctuation according to its AST context", () => {
    const input = [
      "interface Example<T extends Base>{optional?:T;method(value:T):Promise<T>;}",
      "class Service<T extends Base>{value:T;run(input:T):T{return input;}}",
      "const selected=enabled?primary:fallback;",
      "type Choice<T>=T extends string?A:B;",
      "const config={key:value};",
      "const asserted=value as const;",
      "const checked=value satisfies Shape;",
      "type Keys=keyof Shape;",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript" });

    expect(output).toContain("interface Example<T extends Base> {");
    expect(output).toContain("optional?: T;");
    expect(output).toContain("method( value: T ): Promise<T>;");
    expect(output).toContain("class Service<T extends Base> {");
    expect(output).toContain("enabled ? primary : fallback");
    expect(output).toContain("T extends string ? A : B");
    expect(output).toContain("key: value");
    expect(output).toContain("value as const");
    expect(output).toContain("value satisfies Shape");
    expect(output).toContain("keyof Shape");
    expect(format(output, { language: "typescript" })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
  });

  it("normalizes import and export punctuation without collapsing multiline declarations", () => {
    const input = "import{foo,type Bar as Baz}from'pkg';\nexport{foo as renamed,type Baz}from'pkg';\n";
    const output = format(input, { language: "typescript" });
    expect(output).toBe(
      "import { foo, type Bar as Baz } from 'pkg';\n\n" +
      "export { foo as renamed, type Baz } from 'pkg';\n",
    );
    expect(format(output, { language: "typescript" })).toBe(output);
  });

  it("preserves comments and automatic-semicolon-insertion boundaries", () => {
    const input = [
      "const sum=left/* keep  exact */+right;",
      "function asi(){return",
      "value;}",
      "const continued=source",
      "?.read();",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript" });
    expect(output).toContain("left/* keep  exact */ + right");
    expect(output).toContain("return\n    value;");
    expect(output).toContain("source\n?.read()");
    expect(format(output, { language: "typescript" })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
  });

  it("keeps compact nested object trees compact inside direct call arguments", () => {
    const input = "commands.insertContent({type:this.name,attrs:{source}});\n";
    const output = format(input, { language: "typescript" });
    expect(output).toBe("commands.insertContent( {type: this.name, attrs: {source}} );\n");
    expect(format(output, { language: "typescript" })).toBe(output);
  });

  it("does not let multiline ancestor objects expand nested compact call arguments", () => {
    const input = [
      "configure({",
      "handler:()=>commands.insertContent({type:name,attrs:{source}}),",
      "other:true",
      "});",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript" });
    expect(output).toContain("commands.insertContent( {type: name, attrs: {source}} )");
    expect(format(output, { language: "typescript" })).toBe(output);
  });

  it("expands a compact call-argument object immediately when a method body expands", () => {
    const input = "const stream=new Writable({write(chunk,encoding,callback){consume(chunk);callback();}});\n";
    const output = format(input, { language: "typescript" });
    expect(output).toContain("new Writable( {\n");
    expect(output).toContain("write( chunk, encoding, callback ) {");
    expect(format(output, { language: "typescript" })).toBe(output);
  });

  it("uses line width only to expand and never to collapse", () => {
    const intentional = "foo(\n    first,\n    second\n);\n";
    expect(format(intentional, { language: "typescript", lineWidth: 120 })).toBe(intentional);

    const long = "calculateSomethingComplicated(customer,currentAccount,availablePermissions,environment,requestContext);\n";
    const output = format(long, { language: "typescript", lineWidth: 60 });
    expect(output).toBe(
      "calculateSomethingComplicated(\n" +
      "    customer,\n" +
      "    currentAccount,\n" +
      "    availablePermissions,\n" +
      "    environment,\n" +
      "    requestContext\n" +
      ");\n",
    );
  });

  it("preserves the syntax node following themis-ignore", () => {
    const input = [
      "const before=ready;",
      "// themis-ignore",
      "function legacy ( x,y ){return{x :1,y:  2};}",
      "const after=done;",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript" });

    expect(output).toContain("// themis-ignore\nfunction legacy ( x,y ){return{x :1,y:  2};}");
    expect(output).toContain("const before = ready;");
    expect(output).toContain("const after = done;");
    expect(format(output, { language: "typescript" })).toBe(output);
  });

  it("preserves bounded themis-ignore regions exactly", () => {
    const protectedSource = "const old={left :1,right:  2};\nif(old){run (  old.left,old.right );}";
    const input = [
      "const before=ready;",
      "// themis-ignore-start",
      protectedSource,
      "// themis-ignore-end",
      "const after=done;",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript" });

    expect(output).toContain(`// themis-ignore-start\n${protectedSource}\n// themis-ignore-end`);
    expect(format(output, { language: "typescript" })).toBe(output);
  });

  it("rejects malformed ignore directives", () => {
    expect(() => format("// themis-ignore\n", { language: "typescript" })).toThrow("must be followed");
    expect(() => format("// themis-ignore-start\nconst x=1;\n", { language: "typescript" })).toThrow("no matching");
    expect(() => format("// themis-ignore-end\nconst x=1;\n", { language: "typescript" })).toThrow("no matching");
  });
});
