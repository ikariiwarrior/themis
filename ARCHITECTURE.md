# Architecture and dependency decisions

## Shape

```text
CLI adapter       VS Code adapter
      \             /
   project discovery + config
               |
      format(source, options)
            |
      formatter registry
            |
 JavaScriptFormatter      CssFormatter      JsonFormatter
            |
 @babel/parser AST       PostCSS AST + raws  jsonc-parser AST
            ^
             \             /
              SvelteFormatter
             svelte/compiler AST
```

`src/core` owns the shared language, option, error, and engine contracts. `src/js` owns parsing and JavaScript/TypeScript layout decisions. `src/project` owns validated configuration, file discovery, ignore semantics, and atomic writes. `src/cli` owns argument and exit-code behavior without containing formatting policy.

`editors/vscode` is a separately packaged native document-formatting provider. Its bundle contains the formatter for zero-setup use. In trusted workspaces it searches from the document toward the workspace root for a project-local `@ikarii_warrior/themis`, dynamically imports that version when present, and otherwise uses the bundled engine. Configuration and ignore decisions always pass through the shared project layer. The adapter computes a narrow single replacement from the common prefix and suffix instead of replacing the entire document.

Later engines should implement the same `FormatterEngine` boundary:

- C# and Razor: Roslyn and the Razor syntax APIs in a .NET engine/sidecar;
- Svelte: implemented with the official Svelte compiler parser; module and instance scripts delegate to the JS/TS engine while markup/style regions remain owned by Svelte;
- CSS: implemented with PostCSS's lossless AST/raw-whitespace model; Tailwind-bearing markup remains under the markup owner and class order is preserved;
- JSON: implemented with a strict `jsonc-parser` AST configuration and a JSON-specific printer with mandatory double quotes.

Mixed-language engines own boundary whitespace and delegate only well-defined embedded regions.

## Why `@babel/parser`

The first slice uses `@babel/parser` because it provides, in one small and mature JavaScript dependency:

- JavaScript, TypeScript, JSX, and TSX parsing;
- source ranges and a complete original token stream;
- comments and literal spellings;
- explicit `ParenthesizedExpression` nodes when requested, making authored grouping observable;
- broad current-syntax coverage without requiring a native compiler toolchain.

The formatter intentionally does **not** use `@babel/generator`. An AST generator is allowed to normalize or discard source choices outside this project's implemented rules. Instead, the formatter keeps each token byte-for-byte and owns whitespace changes between those tokens.

Biome's Rust parser and generic formatter infrastructure remain attractive for a later performance-oriented implementation, but Rust is not available in the initial workspace and adopting Biome's formatter crates would substantially enlarge this first vertical slice. The engine boundary keeps that migration possible. The behavioral tests—not this parser choice—are the durable contract.

## Other dependencies

- TypeScript compiles the project and enforces the host/engine contracts.
- Vitest runs golden, syntax-validity, and idempotence tests.
- `tsx` supplies a zero-build development CLI.
- `fast-glob` supplies cross-platform directory and glob discovery.
- `ignore` applies Git-compatible `.gitignore`, `.themisignore`, the legacy `.opinionignore` alias, and configured ignore patterns.
- `svelte` supplies the official component parser and source ranges for lossless embedded-script delegation.
- `postcss` supplies a lossless CSS AST and stringifier whose `raws` model lets this formatter own structural whitespace without regenerating selector/value contents.
- `jsonc-parser` supplies a source-ranged JSON tree; strict parser options reject JSONC features while raw scalar slices preserve escape and numeric spellings.
- Node built-ins provide file and stdin/stdout handling.

The VS Code package keeps its build-only dependencies isolated under `editors/vscode`: `esbuild` produces one extension-host bundle, `@types/vscode` type-checks the stable API surface, and `@vscode/vsce` creates the installable VSIX. None are runtime dependencies of the npm formatter package.

There is no runtime formatter dependency and no fallback to Prettier or Biome.

## Printer model

The formatter performs four stages:

1. Parse the whole source file into an AST plus tokens.
2. Walk known AST nodes to annotate blocks, object literals, calls, statements, concluding returns, generics, and contextual TypeScript punctuation.
3. Apply global typography rules to trivia between tokens, then apply AST-context overrides where a token such as `<`, `>`, `?`, or `:` has multiple grammatical meanings.
4. Reassemble original tokens with the selected trivia and one final newline.

Existing multiline constructs are never collapsed. `lineWidth` is consulted only for expansion. This makes the output deterministic and idempotent while preserving authored grouping and unsupported syntax.

The Svelte engine parses the complete component, obtains exact embedded-region ranges from the official AST, formats recognized JavaScript/TypeScript scripts and ordinary CSS styles, and applies replacements from the end of the document backward. It never searches for script or style tags with regular expressions. Markup and attributes—including Tailwind class order—remain byte-for-byte unchanged apart from global newline normalization and the final newline. Explicit non-CSS style languages are left untouched when the Svelte parser can represent them.

The CSS engine changes container layout and declaration colon spacing through PostCSS `raws`. Selectors, values, custom properties, comments, unknown at-rules, and `@apply` parameters are retained. Invalid CSS fails preflight and is never delegated to another formatter.

The JSON engine always expands non-empty objects, keeps compact arrays when they fit, expands arrays under width pressure, and never collapses an authored multiline array. It prints string keys and scalar values from their original source ranges, so duplicate keys, escapes, and numeric notation are not lost through conversion to JavaScript objects. JSONC syntax is rejected rather than silently accepted.

## Test contract

The suite has three complementary layers:

- golden files lock down exact typography, including the supplied acceptance example;
- Babel reparses every golden output to establish syntax validity;
- every formatted output is formatted a second time to establish idempotence.

Focused tests cover comments/literals, optional chaining, TypeScript syntax, grouping parentheses, direct-argument objects, return spacing, and soft-width expansion.

Project integration tests additionally cover configuration discovery and validation, ignore precedence, directory discovery, check/list/write modes, exit codes, atomic writes, and all-or-nothing parse preflight.

The editor adapter has focused tests for VS Code language mapping, minimal edit calculation, shared configuration, ignored documents, and bounded project-local formatter discovery. Packaging is smoke-tested by installing the VSIX into an isolated extension directory and verifying the registered `ikarii-warrior.themis` identifier.

The development-only corpus checker provides another layer against real applications: every discovered JS/TS file must parse, format, parse again, and produce identical output on the second pass. It never writes to the corpus.
