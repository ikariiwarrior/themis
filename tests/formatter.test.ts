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
    readFile(join(here, "golden", `${name}.output.ts`), "utf8").then((value) => value.replace(/\r\n?/g, "\n")),
  ]);
}

async function jsxGolden(): Promise<[string, string]> {
  return Promise.all([
    readFile(join(here, "golden", "jsx.input.tsx"), "utf8"),
    readFile(join(here, "golden", "jsx.output.tsx"), "utf8").then((value) => value.replace(/\r\n?/g, "\n")),
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

  it("keeps authored inline single-statement bodies on one line", () => {
    const input = [
      "function check(){if(condition){return(blah);}}",
      "async function load(){try{return(await blah());}finally{cleanup();}}",
      "class Levels{#levels:string[]=[];public get levels(){return(this.#levels);}}",
      "",
    ].join("\n");
    const expected = [
      "function check() { if( condition ) { return( blah ); } }",
      "async function load() { try { return( await blah() ); } finally { cleanup(); } }",
      "class Levels {",
      "    #levels: string[] = [];",
      "",
      "    public get levels() { return( this.#levels ); }",
      "}",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript" });

    expect(output).toBe(expected);
    expect(format(output, { language: "typescript" })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();

    const authoredMultiline = "function identity() {\n    return value;\n}\n";
    expect(format(authoredMultiline, { language: "typescript" })).toBe(authoredMultiline);
  });

  it("applies quote preferences conservatively and preserves JSX attribute literals", () => {
    const input = [
      'const converted="alpha";',
      'const escaped="it\'s fine";',
      'const mixed={left:\'one\',right:"two"};',
      'export {converted} from "./module";',
      'const view=<Widget label="Keep authored" value={"convert expression"}/>;',
      "",
    ].join("\n");
    const options = {
      language: "tsx" as const,
      typescriptQuotePreference: "single" as const,
      respectObjectFormatting: true,
    };
    const output = format(input, options);

    expect(output).toContain("const converted = 'alpha';");
    expect(output).toContain("const escaped = 'it\\'s fine';");
    expect(output).toContain("const mixed = {left: 'one', right: \"two\"};");
    expect(output).toContain("from './module';");
    expect(output).toContain('label="Keep authored" value={\'convert expression\'}');
    expect(format(output, options)).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript", "jsx"] })).not.toThrow();

    expect(format("const value='alpha';\n", {
      language: "typescript",
      typescriptQuotePreference: "double",
    })).toBe('const value = "alpha";\n');
  });

  it("respects compact object entries, alignment, and authored property groups when enabled", () => {
    const input = [
      "export const STATUS_OPTIONS = [",
      '  { id: 1, name: "Active" },',
      "",
      '  { id: 2, name: "Inactive" }',
      "] as const;",
      "",
      "export const LogLevelFlags = {",
      "  DEBUG:     'debug',",
      "  INFO:      'info',",
      "  TELEMETRY: 'telemetry'",
      "} as const;",
      "export const ApiErrorCode = {",
      "  None                : 0x00000000, // 0",
      "  GeneralError        : 0x000186A0, // 100000",
      "  InternalServerError : 0x000186A1, // 100001",
      "};",
      "",
    ].join("\n");
    const expected = [
      "export const STATUS_OPTIONS = [",
      '    { id: 1, name: "Active" },',
      "",
      '    { id: 2, name: "Inactive" }',
      "] as const;",
      "",
      "export const LogLevelFlags = {",
      "    DEBUG:     'debug',",
      "    INFO:      'info',",
      "    TELEMETRY: 'telemetry'",
      "} as const;",
      "export const ApiErrorCode = {",
      "    None                : 0x00000000, // 0",
      "    GeneralError        : 0x000186A0, // 100000",
      "    InternalServerError : 0x000186A1, // 100001",
      "};",
      "",
    ].join("\n");
    const options = { language: "typescript" as const, respectObjectFormatting: true };
    const output = format(input, options);

    expect(output).toBe(expected);
    expect(format(output, options)).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
    expect(format("const codes={short   :1,longName :2};\n", {
      language: "typescript",
      respectObjectFormatting: false,
    })).toBe("const codes = {\n    short: 1,\n    longName: 2\n};\n");
  });

  it("separates documented object properties and preserves ordinary blank property groups", () => {
    const input = [
      "const formatter={",
      "title:value=>value,",
      "/** Converts the value. */",
      "snake:value=>value,",
      "",
      "kebab:value=>value",
      "};",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript" });

    expect(output).toContain("title: value => value,\n\n    /** Converts the value. */\n    snake: value => value,");
    expect(output).toContain("snake: value => value,\n\n    kebab: value => value");
    expect(format(output, { language: "typescript" })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
  });

  it("indents nested multiline calls, arrays, objects, and callback blocks by ancestry", () => {
    const input = [
      "export const absbool=z.codec(",
      "z.union( [",
      "z.literal( 'yes' ),",
      "z.literal( 'no' )",
      "] ).optional(),",
      "z.boolean().optional(),",
      "{",
      "decode:( value )=>{",
      "if(value==='yes'){return ( true );}",
      "return ( false );",
      "},",
      "encode:( bool )=>bool?'yes':'no'",
      "}",
      ");",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript" });

    expect(output).toContain("z.codec(\n    z.union( [\n        z.literal( 'yes' ),\n        z.literal( 'no' )\n    ] ).optional(),");
    expect(output).toContain("    {\n        decode: ( value ) => {\n\n            if( value === 'yes' ) { return ( true ); }");
    expect(output).toContain("\n            return ( false );\n        },\n        encode:");
    expect(output.endsWith("\n    }\n);\n")).toBe(true);
    expect(format(output, { language: "typescript" })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
  });

  it("spaces non-empty square brackets without changing empty brackets", () => {
    expect(format("const first=values[0];const list=[1,2];const empty=[];\n", { language: "typescript" })).toBe(
      "const first = values[ 0 ];\nconst list = [ 1, 2 ];\nconst empty = [];\n",
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
      "import { foo, type Bar as Baz } from 'pkg';\n" +
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

  it("keeps same-line object property comments trailing", () => {
    const input = [
      "export const ApiErrorCode={",
      "None                        :0x00000000, // 0",
      "GeneralError                :0x000186A0, // 100000",
      "InternalServerError         :0x000186A1, // 100001",
      "}",
      "",
    ].join("\n");
    const expected = [
      "export const ApiErrorCode = {",
      "  None: 0x00000000, // 0",
      "  GeneralError: 0x000186A0, // 100000",
      "  InternalServerError: 0x000186A1, // 100001",
      "}",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript", indent: "  " });

    expect(output).toBe(expected);
    expect(format(output, { language: "typescript", indent: "  " })).toBe(output);
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

  it("carries an authored call-chain continuation into its callback block", () => {
    const input = [
      "class Service{",
      "#loggers:Logger[]=[];",
      "run(entry:Entry){",
      "this.#loggers.filter((logger)=>logger.boundary>=LogLevels.Telemetry)",
      "  .map((logger)=>{",
      "  logger.info(entry);",
      "});",
      "}",
      "}",
      "",
    ].join("\n");
    const expected = [
      "class Service {",
      "  #loggers: Logger[] = [];",
      "",
      "  run( entry: Entry ) {",
      "",
      "    this.#loggers.filter( ( logger ) => logger.boundary >= LogLevels.Telemetry )",
      "      .map( ( logger ) => {",
      "",
      "        logger.info( entry );",
      "      } );",
      "  }",
      "}",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript", indent: "  " });

    expect(output).toBe(expected);
    expect(format(output, { language: "typescript", indent: "  " })).toBe(output);
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

  it("compacts template interpolation delimiters without compacting code blocks", () => {
    const input = [
      "export type api_path = `${ Lowercase<api_topic> }/${Lowercase<string> }`;",
      "function resolve(value:string){",
      "const path=`${ value }`;",
      "return path;",
      "}",
      "",
    ].join("\n");
    const expected = [
      "export type api_path = `${Lowercase<api_topic>}/${Lowercase<string>}`;",
      "function resolve( value: string ) {",
      "",
      "    const path = `${value}`;",
      "",
      "    return path;",
      "}",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript" });

    expect(output).toBe(expected);
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
      "const config = defineConfig( {} );",
      "",
    ].join("\n");

    const output = format(input, { language: "typescript" });
    expect(output).toBe(expected);
    expect(format(output, { language: "typescript" })).toBe(output);
  });

  it("keeps related variable declarations together and preserves authored groups", () => {
    const input = [
      'let inputValue=$state("");',
      "let isComposing=$state(false);",
      "let activeIndex=$state(-1);",
      "let open=$state(false);",
      "",
      "const listboxId=$derived(inputId?`${inputId}-listbox`:`search-listbox`);",
      "const MAX_SUGGESTIONS=8;",
      "",
    ].join("\n");
    const expected = [
      'let inputValue = $state( "" );',
      "let isComposing = $state( false );",
      "let activeIndex = $state( - 1 );",
      "let open = $state( false );",
      "",
      "const listboxId = $derived( inputId ? `${inputId}-listbox` : `search-listbox` );",
      "const MAX_SUGGESTIONS = 8;",
      "",
    ].join("\n");

    const output = format(input, { language: "typescript", indent: "  " });
    expect(output).toBe(expected);
    expect(format(output, { language: "typescript", indent: "  " })).toBe(output);
  });

  it("keeps exports and other top-level statements together unless the author separates them", () => {
    const input = [
      "export * as Types from '#subplot/types/logging.js';",
      "export * as Service from './logging.service.js';",
      "type LogLevel='info'|'error';",
      "const defaultLevel:LogLevel='info';",
      "configure(defaultLevel);",
      "",
      "export const configured=true;",
      "",
    ].join("\n");
    const expected = [
      "export * as Types from '#subplot/types/logging.js';",
      "export * as Service from './logging.service.js';",
      "type LogLevel = 'info' | 'error';",
      "const defaultLevel: LogLevel = 'info';",
      "configure( defaultLevel );",
      "",
      "export const configured = true;",
      "",
    ].join("\n");

    const output = format(input, { language: "typescript" });
    expect(output).toBe(expected);
    expect(format(output, { language: "typescript" })).toBe(output);
  });

  it("only introduces a blank line automatically before a concluding return", () => {
    const input = [
      "function resolve(value:string){",
      "const normalized=value.trim();",
      "log(normalized);",
      "return normalized;",
      "}",
      "",
    ].join("\n");
    const expected = [
      "function resolve( value: string ) {",
      "",
      "    const normalized = value.trim();",
      "    log( normalized );",
      "",
      "    return normalized;",
      "}",
      "",
    ].join("\n");

    const output = format(input, { language: "typescript" });
    expect(output).toBe(expected);
    expect(format(output, { language: "typescript" })).toBe(output);
  });

  it("opens inline flow bodies with one blank line without spacing declaration containers", () => {
    const input = [
      "if(ready){",
      "const retVal='asdf';",
      "use(retVal);",
      "}",
      "const resolve=():string=>{",
      "const retVal='asdf';",
      "return retVal;",
      "};",
      "function nextLine()",
      "{",
      "work();",
      "}",
      "if(waiting)",
      "{",
      "pause();",
      "}",
      "const config={",
      "enabled:true,",
      "};",
      "class Service{",
      "value:string;",
      "run(){",
      "work();",
      "}",
      "}",
      "interface Shape{",
      "value:string;",
      "}",
      "type Result={",
      "value:string;",
      "};",
      "",
    ].join("\n");
    const expected = [
      "if( ready ) {",
      "",
      "    const retVal = 'asdf';",
      "    use( retVal );",
      "}",
      "const resolve = (): string => {",
      "",
      "    const retVal = 'asdf';",
      "",
      "    return retVal;",
      "};",
      "function nextLine()",
      "{",
      "    work();",
      "}",
      "if( waiting ) {",
      "",
      "    pause();",
      "}",
      "const config = {",
      "    enabled: true,",
      "};",
      "class Service {",
      "    value: string;",
      "",
      "    run() {",
      "",
      "        work();",
      "    }",
      "}",
      "interface Shape {",
      "    value: string;",
      "}",
      "type Result = {",
      "    value: string;",
      "};",
      "",
    ].join("\n");

    const output = format(input, { language: "typescript" });
    expect(output).toBe(expected);
    expect(format(output, { language: "typescript" })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
    expect(format("if(ok){run();}\n", { language: "javascript" })).toBe("if( ok ) { run(); }\n");
  });

  it("separates executable class members while keeping consecutive fields grouped", () => {
    const input = [
      "export class LoggerService{",
      "readonly #context:Types.LoggerContext;",
      "readonly #minimumLevel:Types.LogLevel;",
      "constructor(context:Types.LoggerContext={}){this.#context=context;}",
      "withContext(context:Types.LoggerContext){return new LoggerService(context);}",
      "/** Writes a debug entry. */",
      "debug(message:string){this.write(message);}",
      "private write(message:string){console.debug(message);}",
      "}",
      "interface LoggerShape{",
      "context:Types.LoggerContext;",
      "debug(message:string):void;",
      "}",
      "",
    ].join("\n");
    const expected = [
      "export class LoggerService {",
      "  readonly #context: Types.LoggerContext;",
      "  readonly #minimumLevel: Types.LogLevel;",
      "",
      "  constructor( context: Types.LoggerContext = {} ) { this.#context = context; }",
      "",
      "  withContext( context: Types.LoggerContext ) { return new LoggerService( context ); }",
      "",
      "  /** Writes a debug entry. */",
      "  debug( message: string ) { this.write( message ); }",
      "",
      "  private write( message: string ) { console.debug( message ); }",
      "}",
      "interface LoggerShape {",
      "  context: Types.LoggerContext;",
      "  debug( message: string ): void;",
      "}",
      "",
    ].join("\n");

    const output = format(input, { language: "typescript", indent: "  " });
    expect(output).toBe(expected);
    expect(format(output, { language: "typescript", indent: "  " })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
    expect(format("class Plain{first(){}second(){}}\n", { language: "javascript", indent: "  " })).toBe(
      "class Plain {\n  first() {}\n\n  second() {}\n}\n",
    );
  });

  it("keeps documentation comments attached to the declarations they document", () => {
    const input = [
      "import { getRequestEvent } from '$app/server';",
      "",
      "/**",
      " * Sets the customer authentication cookies.",
      " * @param token - The bearer token returned by the API.",
      " */",
      "export function setAuthCookies(token:string):void{",
      "getRequestEvent().cookies.set('__c_token',token,{path:'/'});",
      "}",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript", indent: "  " });

    expect(output).toContain("from '$app/server';\n\n/**");
    expect(output).toContain(" * @param token - The bearer token returned by the API.\n */\nexport function setAuthCookies");
    expect(output).not.toContain(" */\n\nexport function setAuthCookies");
    expect(format(output, { language: "typescript", indent: "  " })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
  });

  it("keeps authored section spacing before comments instead of moving it after them", () => {
    const input = [
      "const first=1;",
      "",
      "// Related setup",
      "const second=2;",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript" });

    expect(output).toBe("const first = 1;\n\n// Related setup\nconst second = 2;\n");
    expect(format(output, { language: "typescript" })).toBe(output);
  });

  it("normalizes declarations nested in TypeScript namespace and global module bodies", () => {
    const input = [
      "interface PlatformEnv{TOKEN:string;}",
      "declare global {",
      "    namespace App {",
      "      interface Platform {",
      "      env?:PlatformEnv;",
      "    }",
      "        interface Error {",
      "      errorId?:string;",
      "      meta?:{",
      "                route:string;",
      "                telemetry?:unknown;",
      "            };",
      "    }",
      "    // interface Locals {}",
      "    }",
      "    declare const __VERSION__:string;",
      "}",
      "export {};",
      "",
    ].join("\n");
    const expected = [
      "interface PlatformEnv {",
      "  TOKEN: string;",
      "}",
      "declare global {",
      "  namespace App {",
      "    interface Platform {",
      "      env?: PlatformEnv;",
      "    }",
      "    interface Error {",
      "      errorId?: string;",
      "      meta?: {",
      "        route: string;",
      "        telemetry?: unknown;",
      "      };",
      "    }",
      "    // interface Locals {}",
      "  }",
      "  declare const __VERSION__: string;",
      "}",
      "export {};",
      "",
    ].join("\n");

    const output = format(input, { language: "typescript", indent: "  " });
    expect(output).toBe(expected);
    expect(format(output, { language: "typescript", indent: "  " })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
  });

  it("does not treat generic type commas as multiline object property boundaries", () => {
    const input = "const config={auth:{headers:(apiKey:string,token:string|undefined):Record<string,string>=>getAuthHeaders(apiKey,token),},};\n";
    const expected = [
      "const config = {",
      "    auth: {",
      "        headers: ( apiKey: string, token: string | undefined ): Record<string, string> => getAuthHeaders( apiKey, token ),",
      "    },",
      "};",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript" });

    expect(output).toBe(expected);
    expect(format(output, { language: "typescript" })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
  });

  it("formats realistic global interfaces without padding trailing comments", () => {
    const input = [
      "declare global {",
      "    namespace App {",
      "",
      "      interface Platform {",
      "        env?: PlatformEnv;",
      "        cf?: IncomingRequestCfProperties;",
      "        ctx?: ExecutionContext;",
      "        caches?: CacheStorage;",
      "      }",
      "",
      "      interface Error {",
      "        errorId?: string; //custom shape",
      "        userId?: number; //custom shape",
      "        traceId?: string; //custom shape",
      "        status: number; //required shape",
      "        message: string; //required shape",
      "        meta?: {",
      "          route: string;",
      "          path: string;",
      "          telemetry?: unknown;",
      "        }; //custom shape",
      "        innerException?: unknown; //custom shape",
      "      }",
      "",
      "      interface Locals {",
      "        userId?: number | null;",
      "        traceId?: string | null;",
      "        identity?: {",
      "            id: number;",
      "            name: string;",
      "            email: string;",
      "            token: string;",
      "            educator: boolean;",
      "        } | null;",
      "        request: {",
      "          remoteAddress: string;",
      "          host: string;",
      "          port: number;",
      "          path: string;",
      "          route: string;",
      "          isRemote: boolean;",
      "          json?: string | null;",
      "          form?: FormData | null;",
      "          text?: string | null;",
      "        };",
      "        debug?: boolean | null;",
      "      }",
      "        ",
      "    // interface Error {}",
      "    // interface Locals {}",
      "    // interface PageData {}",
      "    // interface PageState {}",
      "    // interface Platform {}",
      "    }",
      "",
      "    declare const __VERSION__: string;",
      "}",
      "",
      "export { };",
      "",
    ].join("\n");
    const expected = [
      "declare global {",
      "  namespace App {",
      "",
      "    interface Platform {",
      "      env?: PlatformEnv;",
      "      cf?: IncomingRequestCfProperties;",
      "      ctx?: ExecutionContext;",
      "      caches?: CacheStorage;",
      "    }",
      "",
      "    interface Error {",
      "      errorId?: string; //custom shape",
      "      userId?: number; //custom shape",
      "      traceId?: string; //custom shape",
      "      status: number; //required shape",
      "      message: string; //required shape",
      "      meta?: {",
      "        route: string;",
      "        path: string;",
      "        telemetry?: unknown;",
      "      }; //custom shape",
      "      innerException?: unknown; //custom shape",
      "    }",
      "",
      "    interface Locals {",
      "      userId?: number | null;",
      "      traceId?: string | null;",
      "      identity?: {",
      "        id: number;",
      "        name: string;",
      "        email: string;",
      "        token: string;",
      "        educator: boolean;",
      "      } | null;",
      "      request: {",
      "        remoteAddress: string;",
      "        host: string;",
      "        port: number;",
      "        path: string;",
      "        route: string;",
      "        isRemote: boolean;",
      "        json?: string | null;",
      "        form?: FormData | null;",
      "        text?: string | null;",
      "      };",
      "      debug?: boolean | null;",
      "    }",
      "",
      "    // interface Error {}",
      "    // interface Locals {}",
      "    // interface PageData {}",
      "    // interface PageState {}",
      "    // interface Platform {}",
      "  }",
      "",
      "  declare const __VERSION__: string;",
      "}",
      "",
      "export { };",
      "",
    ].join("\n");

    const output = format(input, { language: "typescript", indent: "  " });
    expect(output).toBe(expected);
    expect(format(output, { language: "typescript", indent: "  " })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
  });

  it("keeps optional semicolons attached to TypeScript interface declarations", () => {
    const input = [
      "export interface UserInfo{",
      "id:number;",
      "};",
      "export interface ApiScopedErrorDetail{",
      "message?:string|null;",
      "};",
      "",
    ].join("\n");
    const expected = [
      "export interface UserInfo {",
      "  id: number;",
      "};",
      "export interface ApiScopedErrorDetail {",
      "  message?: string | null;",
      "};",
      "",
    ].join("\n");

    const output = format(input, { language: "typescript", indent: "  " });
    expect(output).toBe(expected);
    expect(output).not.toContain("}\n;");
    expect(format(output, { language: "typescript", indent: "  " })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
  });

  it("carries array continuation depth into nested argument objects and comments", () => {
    const input = [
      "export default defineConfig({",
      "plugins:[",
      "enhancedImages(),",
      "sveltekit({",
      "version:{name:child_process.execSync('git rev-parse HEAD').toString().trim()},",
      "compilerOptions:{",
      "// Force runes mode for the project.",
      "runes:( { filename } ) =>",
      "filename.split(/[/\\\\]/).includes('node_modules')?undefined:true,",
      "experimental:{async:true}",
      "},",
      "// Use the Cloudflare adapter.",
      "adapter:adapter()",
      "})",
      "]",
      "});",
      "",
    ].join("\n");
    const output = format(input, { language: "typescript", indent: "  " });

    expect(output).toContain("  plugins: [\n    enhancedImages(),\n    sveltekit( {");
    expect(output).toContain("\n      version: {\n        name: child_process.execSync( 'git rev-parse HEAD' ).toString().trim()\n      },");
    expect(output).toContain("\n      compilerOptions: {\n        // Force runes mode for the project.\n        runes: ( { filename } ) =>\n          filename.split(");
    expect(output).toContain("\n      // Use the Cloudflare adapter.\n      adapter: adapter()\n    } )\n  ]\n} );");
    expect(format(output, { language: "typescript", indent: "  " })).toBe(output);
    expect(() => parse(output, { sourceType: "unambiguous", plugins: ["typescript"] })).not.toThrow();
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
