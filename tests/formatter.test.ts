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

async function jsxGolden(): Promise<[string, string]> {
  return Promise.all([
    readFile(join(here, "golden", "jsx.input.tsx"), "utf8"),
    readFile(join(here, "golden", "jsx.output.tsx"), "utf8"),
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

  it("formats JSX and TSX with AST-aware delimiter and attribute rules", async () => {
    const [input, expected] = await jsxGolden();
    const output = format(input, { language: "tsx" });

    expect(output).toBe(expected);
    expect(output).toContain("Keep   exact");
    expect(format(output, { language: "tsx" })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript", "jsx"] })).not.toThrow();
  });

  it("formats fragments and nested JSX without rewriting text-bearing nodes", () => {
    const input = [
      "function View(){return (<>",
      "<Header/>",
      "<main>",
      "Keep   this text",
      "<Row value={item.value}/>",
      "</main>",
      "</>);}",
      "",
    ].join("\n");
    const output = format(input, { language: "tsx" });

    expect(output).toContain("<>\n        <Header />\n        <main>");
    expect(output).toContain("Keep   this text");
    expect(output).toContain("<Row value={item.value} />");
    expect(output).toContain("</main>\n    </>");
    expect(format(output, { language: "tsx" })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript", "jsx"] })).not.toThrow();
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
    expect(output).toContain("source\n    ?.read()");
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

  it("applies width pressure after its own typography changes", () => {
    const input = "const result=calculate(alpha,beta,gamma,delta);\n";
    const output = format(input, { language: "typescript", lineWidth: 36 });

    expect(output).toBe([
      "const result = calculate(",
      "    alpha,",
      "    beta,",
      "    gamma,",
      "    delta",
      ");",
      "",
    ].join("\n"));
    expect(format(output, { language: "typescript", lineWidth: 36 })).toBe(output);
  });

  it("normalizes authored multiline continuations", () => {
    const input = [
      "function collect(condition:boolean){",
      "const values=[",
      "first,",
      "second,",
      "third",
      "];",
      "const selected=condition",
      "?first",
      ":second;",
      "const result=service",
      "?.client",
      ".load();",
      "return values;",
      "}",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript" });

    expect(output).toContain("const values = [\n        first,\n        second,\n        third\n    ];");
    expect(output).toContain("const selected = condition\n        ? first\n        : second;");
    expect(output).toContain("const result = service\n        ?.client\n        .load();");
    expect(format(output, { language: "typescript" })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
  });

  it("keeps callback body indentation after a preserved multiline call", () => {
    const input = [
      "export const template=query(z.object({productId:z.number().int()}),async(payload):Promise<Models.TemplateModel|null>=>{",
      "  const result=await Base.custom<Models.TemplateModel>(",
      "        `customize/template/${payload.productId}` ,",
      "        Http.Method.POST,",
      "        payload,",
      "        Api.ApiTypeFlags.Public",
      "    );",
      "console.log(result);",
      "console.log(payload.productId);",
      "if(!result.success||!result.data){",
      "  console.error(`failed: ${payload.productId}`);",
      "}",
      "return (null);",
      "});",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript" });

    expect(output).toContain("\n    console.log( result );\n    console.log( payload.productId );\n    if( !result.success || !result.data ) {");
    expect(output).toContain("\n        console.error( `failed: ${payload.productId}` );\n    }");
    expect(output).toContain("\n\n    return ( null );\n} );");
    expect(format(output, { language: "typescript" })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
  });

  it("does not interpret template text as structural delimiters", () => {
    const input = [
      "const rows=entries.map(([role,token])=>{",
      "const sessionId=create(token);",
      "return `('${sessionId}', '${ids[role]}', ${expiresAt})`;",
      "}).join(',\\n');",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript" });

    expect(output).toContain("return `('${sessionId}', '${ids[ role ]}', ${expiresAt})`;");
    expect(output).toContain("} ).join( ',\\n' )");
    expect(format(output, { language: "typescript" })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
  });

  it("keeps object nesting balanced across template interpolations", () => {
    const input = [
      "const provider={format(){",
      "const a=`${one}`;",
      "const b=`${two}`;",
      "const c=`${three}`;",
      "const d=`${four}`;",
      "return [replace(new Range(first(),second()),value)];",
      "}};",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript" });

    expect(output).toContain("new Range( first(), second() )");
    expect(format(output, { language: "typescript" })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
  });

  it("normalizes leading indentation for program statements and standalone comments", () => {
    const input = [
      "    const first=1;",
      "",
      "  /* section",
      "   * detail",
      "   */",
      "  const second=()=>{",
      "      return first;",
      "  };",
      "",
    ].join("\n");
    const expected = [
      "const first = 1;",
      "",
      "/* section",
      " * detail",
      " */",
      "",
      "const second = () => {",
      "  return first;",
      "};",
      "",
    ].join("\n");

    const output = format(input, { language: "typescript", indent: "  " });
    expect(output).toBe(expected);
    expect(format(output, { language: "typescript", indent: "  " })).toBe(output);
  });

  it("keeps related imports together and preserves authored import groups", () => {
    const input = [
      "import * as childProcess from 'node:child_process';",
      "import { sveltekit } from '@sveltejs/kit/vite';",
      "",
      "import { enhancedImages } from '@sveltejs/enhanced-img';",
      "// import adapter from '@sveltejs/adapter-auto';",
      "import adapter from '@sveltejs/adapter-cloudflare';",
      "const config=defineConfig({});",
      "",
    ].join("\n");
    const expected = [
      "import * as childProcess from 'node:child_process';",
      "import { sveltekit } from '@sveltejs/kit/vite';",
      "",
      "import { enhancedImages } from '@sveltejs/enhanced-img';",
      "// import adapter from '@sveltejs/adapter-auto';",
      "import adapter from '@sveltejs/adapter-cloudflare';",
      "",
      "const config = defineConfig( {} );",
      "",
    ].join("\n");

    const output = format(input, { language: "typescript" });
    expect(output).toBe(expected);
    expect(format(output, { language: "typescript" })).toBe(output);
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
