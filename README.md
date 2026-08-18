# Themis

<p align="center">
  <img src="assets/themis-mark.png" alt="Themis mark" width="180">
</p>

Themis is a syntax-aware, intent-preserving, opinionated formatter for JavaScript, TypeScript, JSX, TSX, Svelte, CSS, and JSON. Its typography rules—not Prettier or Biome output—define the result.

Implemented in this slice:

- one space inside non-empty parentheses and none inside empty parentheses;
- no space before call, method, function, or control-flow parentheses;
- spaces around binary and assignment operators;
- comma spacing;
- spacing inside non-empty square brackets;
- compact TypeScript generic delimiters with comma spacing, such as `Map<Key, Value>`;
- contextual TypeScript punctuation for annotations, optional members, conditional types, ternaries, `as`, `satisfies`, and type operators;
- normalized import/export braces and keywords;
- AST-aware JSX/TSX tag delimiters, compact expression containers, self-closing tags, fragments, and prop layout;
- width-driven JSX prop expansion that never collapses an authored multiline opening tag;
- stable continuation indentation for authored multiline calls, arrays, member chains, ternaries, nested callbacks, and parenthesized expressions;
- multiline class and interface bodies;
- preservation of every explicit grouping parenthesis;
- JavaScript/TypeScript block braces on the statement line;
- one empty line after an inline opening brace for TypeScript/TSX function and control-flow bodies, without applying that spacing to object, class, interface, namespace, or type-literal containers;
- multiline object literals by default;
- compact versus multiline intent preservation for object literals passed directly as function arguments;
- a soft, configurable line width (120 by default) that expands long calls and never collapses authored multiline constructs;
- a blank line before a concluding `return` only when earlier statements performed work;
- preservation of token spelling, comments, literals, and syntax outside the implemented layout rules;
- Svelte component parsing through the official compiler, with markup expressions plus module and instance scripts delegated to the JS/TS engine;
- AST-aware Svelte attribute/directive layout and structural indentation for `if`, `each`, `await`, `key`, and `snippet` blocks;
- syntax-aware CSS formatting for standalone `.css` files and ordinary Svelte `<style>` regions;
- preservation of Svelte literal attribute contents and Tailwind class values, including spacing and class ordering;
- strict JSON formatting with raw string/number spelling preservation and soft-width array expansion.

The acceptance example formats as:

```ts
const z = ( x * y ) - ( ( x - y ) * 3 );

if( z > 10 && foo( z, true ) ) {
    bar( z, 2 );
}
```

## Run it

Node.js 20 or newer is required.

Install Themis in a project:

```sh
npm install --save-dev @ikarii_warrior/themis
```

Use the CLI:

```sh
npx themis --check src
npx themis --write src
```

For repository development:

```sh
npm install
npm test
npm run build
```

Format stdin:

```sh
echo "const z=(x*y);" | npm run format --silent
```

Format a file to stdout or in place:

```sh
npm run format -- source.ts
npm run format -- --write source.ts
```

Format a directory or glob, check formatting in CI, or list only changed files:

```sh
npm run format -- --write src tests
npm run format -- --check "src/**/*.{js,ts,tsx}"
npm run format -- --list-different src
```

The CLI accepts multiple files, directories, and globs. Multiple inputs require `--write`, `--check`, or `--list-different`. It recursively discovers JavaScript, TypeScript, Svelte, CSS, and JSON extensions and honors `.gitignore`, `.themisignore`, the legacy `.opinionignore` alias, built-in dependency/build exclusions, and configured ignore patterns.

For repeated local or CI runs, enable the content-addressed cache:

```sh
npx themis --check --cache src tests
npx themis --write --cache src
```

The default cache is `.themis-cache`; add it to `.gitignore`. `--cache-location <path>` can place it under an existing cache convention such as `node_modules/.cache/themis`. Entries are valid only for the exact Themis version, resolved formatting configuration, absolute file path, and source hash. Only files proven clean are cached, and parse failures never update the cache.

To format changes outside an editor integration:

```sh
npx themis --write --watch --cache src tests
```

Watch mode runs one complete all-or-nothing write pass, then debounces supported filesystem changes. It reloads `themis.json`, ignore files, and discovery on every pass. Press Ctrl+C to stop it. The VS Code extension already handles format-on-save directly, so most VS Code users should use one workflow or the other rather than both.

## Lint and pre-commit integration

Themis needs no ESLint formatter plugin. Give linting and formatting separate commands so each tool reports its own failures:

```json
{
  "scripts": {
    "format": "themis --write --cache src tests",
    "format:check": "themis --check --cache src tests",
    "lint": "eslint src tests",
    "validate": "npm run format:check && npm run lint && npm test"
  }
}
```

For staged-file formatting with `lint-staged`, install it using the workflow your project prefers and add:

```json
{
  "lint-staged": {
    "*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,svelte,css,json}": "themis --write"
  }
}
```

`lint-staged` appends its matched filenames and re-stages successful edits. Omitting `--cache` keeps the hook self-contained and avoids creating a cache file during commits. A CI job should run `npm run format:check`; exit code `1` means formatting differs, while `2` means configuration, parsing, or I/O failed.

Exit codes are stable for automation:

- `0`: success, or every checked file is already formatted;
- `1`: `--check` or `--list-different` found files that would change;
- `2`: invalid arguments/configuration, parse errors, or filesystem failures.

## Project configuration

The CLI searches from the working directory toward the filesystem root for `themis.json`. The legacy name `opinion.json` remains a compatibility alias. An explicit file can be selected with `--config <path>`.

```json
{
  "lineWidth": 120,
  "indent": {
    "type": "spaces",
    "size": 4
  },
  "ignore": [
    "generated/"
  ]
}
```

Configuration is validated strictly so misspelled options fail visibly. Tabs use one tab per indentation level; `indent.size` remains the preferred editor width in that mode.

For stdin whose language cannot be inferred from a filename:

```sh
cat component.tsx | themis --stdin-file-path component.tsx
```

The library API is deliberately small:

```ts
import { format } from "@ikarii_warrior/themis";

const output = format(source, {
  language: "typescript",
  lineWidth: 120,
  indent: "    ",
});
```

## Formatter escape directives

Use `themis-ignore` when a valid syntax node must retain its authored whitespace. The directive preserves the next statement, declaration, member, property, or other parser node while the rest of the file is formatted normally:

```ts
// themis-ignore
const generated={left :1,right:  2};
```

Use a bounded pair for multiple nodes:

```ts
// themis-ignore-start
const first={left :1};
const second =  {right:2};
// themis-ignore-end
```

CSS uses the equivalent block comments:

```css
/* themis-ignore */
.legacy { color :red;padding:  0 }
```

The directives work inside supported Svelte `<script>` and `<style>` regions through their delegated engines. Directive text must occupy the whole comment. Nested, unmatched, or targetless directives fail formatting without changing the file. The complete file must remain syntactically valid because Themis always parses before formatting. Final-newline normalization still applies.

## Visual Studio Code

The first-party extension registers Themis as a native formatter for JavaScript, TypeScript, JSX, TSX, Svelte, CSS (including the Tailwind CSS language mode), and JSON. It bundles the formatter, so format-on-save does not require a global or project installation. In a trusted workspace it prefers a project-local `@ikarii_warrior/themis` dependency when available, keeping editor, CLI, hooks, and CI on the same pinned version.

Build and install the development VSIX:

```sh
npm run vscode:install
npm run vscode:package
code --install-extension editors/vscode/dist/themis-vscode-0.4.9.vsix
```

Then add this to `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "[javascript][javascriptreact][typescript][typescriptreact][svelte][css][tailwindcss][json]": {
    "editor.defaultFormatter": "ikarii.themis-formatter"
  }
}
```

The extension uses the same `themis.json`, `.themisignore`, and failure-without-modification behavior as the CLI. Set `themis.useLocalVersion` to `false` to always use its bundled engine. See [`editors/vscode/README.md`](./editors/vscode/README.md) for editor-specific details.

## Safety boundary

The formatter parses every selected file before changing any of them. It reconstructs output from the parser's original tokens and changes inter-token trivia plus layout-only JSX whitespace nodes. Text-bearing JSX content retains its text and internal spacing. It never asks Prettier, Biome, or Babel's code generator to reprint an unknown node. Consequently, unsupported-but-parseable syntax keeps its original token spelling, comments, and literals. Invalid input produces a `FormatError`; the CLI exits unsuccessfully and `--write` leaves the whole selected set untouched. Successful writes use a temporary sibling file and atomic replacement.

This remains an intentionally evolving formatter rather than a production-complete web formatter. JSX/TSX layout now covers tag punctuation, props, fragments, expression containers, nested layout, and width pressure; specialized expression wrapping and comment placement can continue to grow behind the same AST contract. Svelte markup expressions, expression attributes, spreads, directives, special tags, and control blocks are formatted from compiler-owned ranges. Literal attribute text, inline text content, comments, attribute order, and authored multiline intent remain source-owned. Plain CSS is formatted structurally, while selector contents, declaration values, comments, unknown at-rules, and `@apply` utility order remain intact.

## Tailwind boundary

Tailwind class ordering is deliberately outside this formatter's scope. Class and `className` values are preserved exactly so a Tailwind-focused editor extension or tool can sort utilities using the project's actual Tailwind configuration and plugins. CSS `@apply` parameter order is likewise preserved.

## JSON boundary

`.json` means strict JSON. Comments, trailing commas, single-quoted strings, unquoted keys, and non-finite numbers are rejected. JSONC is intentionally not inferred from filenames such as `tsconfig.json`; it will be added as a distinct language if desired. JSON strings always remain double-quoted, and original escape/number spellings such as `"\u0061"` and `1e3` are preserved.

Repository development also includes a read-only corpus check. It parses and formats every supported source file under a supplied directory twice, failing if parsing or idempotence breaks:

```sh
npm run build
npm run corpus:check -- /path/to/project/src
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for parser selection, dependency rationale, and editor integration design.
