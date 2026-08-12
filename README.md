# Themis

<p align="center">
  <img src="assets/themis-mark.png" alt="Themis mark" width="180">
</p>

Themis is a syntax-aware, intent-preserving, opinionated formatter for JavaScript, TypeScript, Svelte, CSS, and JSON. Its typography rules—not Prettier or Biome output—define the result.

Implemented in this slice:

- one space inside non-empty parentheses and none inside empty parentheses;
- no space before call, method, function, or control-flow parentheses;
- spaces around binary and assignment operators;
- comma spacing;
- spacing inside non-empty square brackets;
- compact TypeScript generic delimiters with comma spacing, such as `Map<Key, Value>`;
- contextual TypeScript punctuation for annotations, optional members, conditional types, ternaries, `as`, `satisfies`, and type operators;
- normalized import/export braces and keywords;
- multiline class and interface bodies;
- preservation of every explicit grouping parenthesis;
- JavaScript/TypeScript block braces on the statement line;
- multiline object literals by default;
- compact versus multiline intent preservation for object literals passed directly as function arguments;
- a soft, configurable line width (120 by default) that expands long calls and never collapses authored multiline constructs;
- a blank line before a concluding `return` only when earlier statements performed work;
- preservation of token spelling, comments, literals, and syntax outside the implemented layout rules;
- Svelte component parsing through the official compiler, with module and instance scripts delegated to the JS/TS engine;
- syntax-aware CSS formatting for standalone `.css` files and ordinary Svelte `<style>` regions;
- byte-preservation of Svelte markup and Tailwind class values, including class ordering;
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

## Visual Studio Code

The first-party extension registers Themis as a native formatter for JavaScript, TypeScript, JSX, TSX, Svelte, CSS (including the Tailwind CSS language mode), and JSON. It bundles the formatter, so format-on-save does not require a global or project installation. In a trusted workspace it prefers a project-local `@ikarii_warrior/themis` dependency when available, keeping editor, CLI, hooks, and CI on the same pinned version.

Build and install the development VSIX:

```sh
npm run vscode:install
npm run vscode:package
code --install-extension editors/vscode/dist/themis-vscode-0.1.1.vsix
```

Then add this to `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "[javascript][javascriptreact][typescript][typescriptreact][svelte][css][tailwindcss][json]": {
    "editor.defaultFormatter": "ikarii-warrior.themis"
  }
}
```

The extension uses the same `themis.json`, `.themisignore`, and failure-without-modification behavior as the CLI. Set `themis.useLocalVersion` to `false` to always use its bundled engine. See [`editors/vscode/README.md`](./editors/vscode/README.md) for editor-specific details.

## Safety boundary

The formatter parses every selected file before changing any of them. It reconstructs output from the parser's original tokens and changes only inter-token trivia. It never asks Prettier, Biome, or Babel's code generator to reprint an unknown node. Consequently, unsupported-but-parseable syntax keeps its original token spelling, comments, and literals. Invalid input produces a `FormatError`; the CLI exits unsuccessfully and `--write` leaves the whole selected set untouched. Successful writes use a temporary sibling file and atomic replacement.

This is intentionally a proof of concept rather than a production-complete web formatter. JSX/TSX parses through the JS/TS engine, but JSX-specific typography is not yet implemented. Svelte markup expressions are preserved rather than reformatted. Plain CSS is formatted structurally, while selector contents, declaration values, comments, unknown at-rules, and `@apply` utility order remain intact. The current width heuristic expands long call argument lists; future node rules can add semantic break opportunities without changing the host contract.

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
