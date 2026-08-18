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
    readFile(join(here, "golden", "svelte.output.svelte"), "utf8").then((value) => value.replace(/\r\n?/g, "\n")),
  ]);
}

describe("Svelte formatter", () => {
  it("formats module, TypeScript, markup expressions, and CSS regions", async () => {
    const [input, expected] = await golden();
    const output = format(input, { language: "svelte" });
    expect(output).toBe(expected);
    expect(output).toContain("<svelte:head><title>Keep   this</title></svelte:head>");
    expect(output).toContain("class=\"px-2   py-1\" onclick={() => count += 1}>{count + 1}");
    expect(output).toContain("        color: red;\n        padding: 0;");
  });

  it("formats attributes and control blocks without reordering Tailwind classes", () => {
    const input = [
      '<Widget class="z-10   flex p-2" value={a+b} {...props} on:click={() => n+=1}>',
      "{#if ok&&ready}<p>{x*y}</p>{:else}<span>{@html raw}</span>{/if}",
      "</Widget>",
      "",
    ].join("\n");
    const expected = [
      '<Widget class="z-10   flex p-2" value={a + b} {...props} on:click={() => n += 1}>',
      "    {#if ok && ready}",
      "        <p>{x * y}</p>",
      "    {:else}",
      "        <span>{@html raw}</span>",
      "    {/if}",
      "</Widget>",
      "",
    ].join("\n");

    const output = format(input, { language: "svelte" });
    expect(output).toBe(expected);
    expect(output).toContain('class="z-10   flex p-2"');
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte" })).toBe(output);
  });

  it("formats each, await, key, snippet, and render syntax", () => {
    const input = [
      "{#each items.filter(x=>x.ok) as {id,name}, i (id)}<p>{name}</p>{:else}<em>none</em>{/each}",
      "{#await load(id)}<p>wait</p>{:then value}<p>{value}</p>{:catch error}<p>{error.message}</p>{/await}",
      "{#key selected.id}<Widget />{/key}",
      "{#snippet row(item,index=0)}<span>{item.name}</span>{/snippet}",
      "{@render row(data)}",
      "",
    ].join("\n");
    const output = format(input, { language: "svelte" });

    expect(output).toContain("{#each items.filter( x => x.ok ) as {id, name}, i (id)}");
    expect(output).toContain("{#await load( id )}");
    expect(output).toContain("{#key selected.id}\n    <Widget />\n{/key}");
    expect(output).toContain("{#snippet row(item, index = 0)}");
    expect(output).toContain("{@render row( data )}");
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte" })).toBe(output);
  });

  it("preserves authored multiline attributes and expands only under width pressure", () => {
    const input = '<Button class="first   second" onclick={()=>save(item)} disabled={!ready}>Save</Button>\n';
    const output = format(input, { language: "svelte", lineWidth: 50 });

    expect(output).toBe([
      "<Button",
      '    class="first   second"',
      "    onclick={() => save( item )}",
      "    disabled={!ready}",
      ">Save</Button>",
      "",
    ].join("\n"));
    expect(format(output, { language: "svelte", lineWidth: 200 })).toBe(output);
  });

  it("formats else-if chains as sibling branches", () => {
    const input = "{#if first}<p>one</p>{:else if second&&third}<p>two</p>{:else if fourth}<p>four</p>{:else}<p>last</p>{/if}\n";
    const expected = [
      "{#if first}",
      "    <p>one</p>",
      "{:else if second && third}",
      "    <p>two</p>",
      "{:else if fourth}",
      "    <p>four</p>",
      "{:else}",
      "    <p>last</p>",
      "{/if}",
      "",
    ].join("\n");

    const output = format(input, { language: "svelte" });
    expect(output).toBe(expected);
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte" })).toBe(output);
  });

  it("uses AST expression ranges when block conditions contain braces", () => {
    const input = "{#if (/}/).test(value)}<p>{`value>${value}`}</p>{:else if (/\\}/).test(other)}no{/if}\n";
    const output = format(input, { language: "svelte" });

    expect(output).toContain("{#if ( /}/ ).test( value )}");
    expect(output).toContain("{:else if ( /\\}/ ).test( other )}");
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte" })).toBe(output);
  });

  it("formats const and debug tags explicitly", () => {
    const input = [
      "{#each items as item}",
      "{@const total=calculate(",
      "item.price,",
      "item.tax",
      ")}",
      "{@debug total,item}",
      "<p>{total}</p>",
      "{/each}",
      "",
    ].join("\n");
    const expected = [
      "{#each items as item}",
      "    {@const total = calculate(",
      "        item.price,",
      "        item.tax",
      "    )}",
      "    {@debug total, item}",
      "    <p>{total}</p>",
      "{/each}",
      "",
    ].join("\n");

    const output = format(input, { language: "svelte" });
    expect(output).toBe(expected);
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte" })).toBe(output);
  });

  it("distinguishes nested branch markers and stabilizes text-only fallbacks", () => {
    const input = "{#each {length:8},rank}{#if rank%2===0}<span>{rank}</span>{:else}<em>{rank}</em>{/if}{:else}empty{/each}\n";
    const expected = [
      "{#each {length: 8}, rank}",
      "    {#if rank % 2 === 0}",
      "        <span>{rank}</span>",
      "    {:else}",
      "        <em>{rank}</em>",
      "    {/if}",
      "{:else}",
      "    empty",
      "{/each}",
      "",
    ].join("\n");

    const output = format(input, { language: "svelte" });
    expect(output).toBe(expected);
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte" })).toBe(output);
  });

  it("propagates descendant width expansion to special-element parents", () => {
    const input = '<svelte:boundary onerror={(error)=>report(error)}><svelte:fragment slot="pending"><p>{message}</p></svelte:fragment></svelte:boundary>\n';
    const output = format(input, { language: "svelte", lineWidth: 60 });

    expect(output).toContain("<svelte:boundary onerror={( error ) => report( error )}>\n    <svelte:fragment");
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte", lineWidth: 60 })).toBe(output);
  });

  it("formats shorthand await branches and destructured branch values", () => {
    const input = [
      "{#await load(id) then {value,error}}<p>{value}</p>{/await}",
      "{#await load(id) catch {message,cause}}<p>{message}</p>{/await}",
      "",
    ].join("\n");
    const expected = [
      "{#await load( id ) then {value, error}}",
      "    <p>{value}</p>",
      "{/await}",
      "{#await load( id ) catch {message, cause}}",
      "    <p>{message}</p>",
      "{/await}",
      "",
    ].join("\n");

    const output = format(input, { language: "svelte" });
    expect(output).toBe(expected);
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte" })).toBe(output);
  });

  it("indents multiline expressions inside authored multiline attributes", () => {
    const input = [
      "<section>",
      "<Button",
      "onclick={(event)=>{event.preventDefault();save(item,event)}}",
      "{shorthand}",
      "{...props}",
      "bind:value={state.value}",
      "class:active={ready&&enabled}",
      'title="keep   exactly"',
      ">Save</Button>",
      "</section>",
      "",
    ].join("\n");
    const expected = [
      "<section>",
      "    <Button",
      "        onclick={( event ) => {",
      "            event.preventDefault();",
      "            save( item, event )",
      "        }}",
      "        {shorthand}",
      "        {...props}",
      "        bind:value={state.value}",
      "        class:active={ready && enabled}",
      '        title="keep   exactly"',
      "    >Save</Button>",
      "</section>",
      "",
    ].join("\n");

    const output = format(input, { language: "svelte" });
    expect(output).toBe(expected);
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte" })).toBe(output);
  });

  it("preserves comments, mixed text, literal attribute segments, and structural blank lines", () => {
    const input = [
      '<svelte:boundary onerror={(error)=>report(error)}>',
      "<!-- keep   this -->",
      "",
      "{#if visible}",
      '<p title="before   {first+last}  after">Hello   {first+last}!</p>',
      "",
      "{#each rows as row (row.id)}<Widget {row} {...shared} use:enhance={options.enhance} />{/each}",
      "{/if}",
      "</svelte:boundary>",
      "",
    ].join("\n");

    const output = format(input, { language: "svelte" });
    expect(output).toContain("<!-- keep   this -->\n\n    {#if visible}");
    expect(output).toContain('title="before   {first + last}  after"');
    expect(output).toContain("Hello   {first + last}!");
    expect(output).toContain("<Widget {row} {...shared} use:enhance={options.enhance} />");
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte" })).toBe(output);
  });

  it("does not borrow a parent closing tag for an implicitly closed SVG", () => {
    const input = [
      '<a href="https://example.com" aria-label="Example">',
      "<svg",
      'viewBox="0 0 10 10"',
      'xmlns="http://www.w3.org/2000/svg"',
      ">",
      '<path d="m0 0h10v10z"></path>',
      "",
      "",
      "</a>",
      "",
    ].join("\n");

    const output = format(input, { language: "svelte", indent: "  " });
    expect(output).toContain('    <path d="m0 0h10v10z"></path>\n</a>');
    expect(output).not.toContain("\n\n\n");
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte", indent: "  " })).toBe(output);
  });

  it("uses TypeScript syntax when formatting markup expressions", () => {
    const input = '<script lang="ts">type Item={value:number};let item:Item;</script>\n<p data-value={item satisfies Item}>{item.value as number}</p>\n';
    const output = format(input, { language: "svelte" });

    expect(output).toContain("data-value={item satisfies Item}");
    expect(output).toContain("{item.value as number}");
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte" })).toBe(output);
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

  it("normalizes top-level script indentation and standalone comments", () => {
    const input = [
      '<script lang="ts">',
      '    import type { LayoutProps } from "./$types";',
      "",
      "  import { beforeNavigate } from '$app/navigation';",
      "",
      "    /*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~/",
      "    / Component Imports",
      "    /~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/",
      "",
      "  let { children, data }: LayoutProps = $props();",
      "",
      "  beforeNavigate( ( { willUnload } ) => {",
      "    if( willUnload ) {",
      "      void children;",
      "    }",
      "  } );",
      "</script>",
      "",
    ].join("\n");

    const output = format(input, { language: "svelte", indent: "  " });
    expect(output).toContain('  import type { LayoutProps } from "./$types";');
    expect(output).toContain("\n  import { beforeNavigate } from '$app/navigation';");
    expect(output).toContain("\n  /*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~/\n  / Component Imports\n  /~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/");
    expect(output).toContain("\n  let { children, data }: LayoutProps = $props();");
    expect(output).toContain("\n  beforeNavigate( ( { willUnload } ) => {\n\n    if( willUnload ) {\n\n      void children;\n    }\n  } );");
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte", indent: "  " })).toBe(output);
  });

  it("keeps trailing TypeScript comments compact in embedded scripts", () => {
    const input = [
      '<script lang="ts">',
      "declare global {",
      "namespace App {",
      "interface Error {",
      "errorId?: string; //custom shape",
      "meta?: { route: string; }; //custom shape",
      "}",
      "}",
      "}",
      "</script>",
      "",
    ].join("\n");

    const output = format(input, { language: "svelte", indent: "  " });
    expect(output).toContain([
      "  declare global {",
      "    namespace App {",
      "      interface Error {",
      "        errorId?: string; //custom shape",
      "        meta?: {",
      "          route: string;",
      "        }; //custom shape",
      "      }",
      "    }",
      "  }",
    ].join("\n"));
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte", indent: "  " })).toBe(output);
  });

  it("opens inline TypeScript flow bodies with a blank line in scripts", () => {
    const input = [
      '<script lang="ts">',
      "const resolve=():string=>{",
      "const value='ready';",
      "return value;",
      "};",
      "if(resolve()){",
      "run();",
      "}",
      "const config={enabled:true};",
      "</script>",
      "",
    ].join("\n");

    const output = format(input, { language: "svelte", indent: "  " });
    expect(output).toContain([
      "  const resolve = (): string => {",
      "",
      "    const value = 'ready';",
      "",
      "    return value;",
      "  };",
      "  if( resolve() ) {",
      "",
      "    run();",
      "  }",
      "  const config = {",
      "    enabled: true",
      "  };",
    ].join("\n"));
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte", indent: "  " })).toBe(output);
  });

  it("separates executable class members in embedded TypeScript", () => {
    const input = [
      '<script lang="ts">',
      "class Service{",
      "readonly value:string;",
      "constructor(value:string){this.value=value;}",
      "run(){return this.value;}",
      "}",
      "</script>",
      "",
    ].join("\n");
    const output = format(input, { language: "svelte", indent: "  " });

    expect(output).toContain([
      "  class Service {",
      "    readonly value: string;",
      "",
      "    constructor( value: string ) {",
      "",
      "      this.value = value;",
      "    }",
      "",
      "    run() {",
      "",
      "      return this.value;",
      "    }",
      "  }",
    ].join("\n"));
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte", indent: "  " })).toBe(output);
  });

  it("keeps related state and constant declarations grouped in scripts", () => {
    const input = [
      '<script lang="ts">',
      'let inputValue=$state("");',
      "let isComposing=$state(false);",
      "let activeIndex=$state(-1);",
      "let open=$state(false);",
      "",
      "const listboxId=$derived(inputId?`${inputId}-listbox`:`search-listbox`);",
      "const MAX_SUGGESTIONS=8;",
      "</script>",
      "",
    ].join("\n");
    const output = format(input, { language: "svelte", indent: "  " });

    expect(output).toContain([
      '  let inputValue = $state( "" );',
      "  let isComposing = $state( false );",
      "  let activeIndex = $state( - 1 );",
      "  let open = $state( false );",
      "",
      "  const listboxId = $derived( inputId ? `${inputId}-listbox` : `search-listbox` );",
      "  const MAX_SUGGESTIONS = 8;",
    ].join("\n"));
    expect(() => parse(output, { modern: true })).not.toThrow();
    expect(format(output, { language: "svelte", indent: "  " })).toBe(output);
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

  it("honors ignore directives in embedded scripts and styles", () => {
    const input = [
      "<script lang=\"ts\">",
      "// themis-ignore",
      "const legacy={left :1,right:  2};",
      "const formatted=legacy.left+legacy.right;",
      "</script>",
      "<style>",
      "/* themis-ignore */",
      ".legacy { color :red;padding:  0 }",
      ".formatted{color:blue}",
      "</style>",
      "",
    ].join("\n");
    const output = format(input, { language: "svelte" });

    expect(output).toContain("const legacy={left :1,right:  2};");
    expect(output).toContain("const formatted = legacy.left + legacy.right;");
    expect(output).toContain(".legacy { color :red;padding:  0 }");
    expect(output).toContain(".formatted {");
    expect(format(output, { language: "svelte" })).toBe(output);
  });
});
