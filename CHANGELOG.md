# Changelog

All notable changes to Themis are recorded here.

## 0.4.4 - 2026-08-17

- Preserve authored blank-line groups between all JavaScript and TypeScript statements instead of forcing separation based on broad declaration or statement categories.
- Keep consecutive exports, imports, variables, functions, control flow, and expression statements together when the author did not separate them.
- Reserve automatic blank-line insertion for a concluding `return` statement and apply the same behavior inside Svelte scripts.

## 0.4.3 - 2026-08-17

- Keep consecutive variable declarations together while preserving authored blank-line groups and comment-separated sections.
- Match Svelte closing tags by element name so implicitly closed children cannot borrow a parent or descendant closing tag.
- Stabilize trailing whitespace at implicit Svelte element boundaries and prevent blank-line growth across repeated formatting passes.

## 0.4.2 - 2026-08-14

- Preserve consecutive imports without inserting blank lines while retaining authored import groups and attached comments.
- Carry multiline-array continuation depth through nested function arguments, objects, properties, comments, and arrow-function bodies.
- Add syntax-validity and idempotence regressions for nested Vite and SvelteKit configuration structures.

## 0.4.1 - 2026-08-14

- Normalize leading indentation for the first top-level statement and standalone comments instead of preserving padding inherited from the input.
- Re-indent multiline comment continuation lines to the configured baseline while preserving their internal content.
- Add direct JavaScript/TypeScript and embedded Svelte regressions for mixed source indentation, configured indentation, syntax validity, and idempotence.

## 0.4.0 - 2026-08-13

- Format Svelte markup expressions, expression attributes, spreads, directives, block conditions, and snippet parameters from Svelte compiler AST ranges.
- Structurally indent Svelte `if`, `each`, `await`, `key`, and `snippet` blocks, including `else if`, shorthand await branches, nested blocks, comments, text-only branches, and authored blank lines.
- Format `{@const}` declarations and `{@debug}` identifier lists explicitly.
- Expand pressured or authored multiline opening tags with stable multiline expression indentation while preserving literal attribute contents, attribute order, and Tailwind class order and spacing.
- Add Svelte golden, syntax-validity, idempotence, TypeScript-expression, special-element, directive, comment, and multiline regression coverage.
- Apply JavaScript/TypeScript width pressure after typography changes and keep multiline-object nesting balanced across template interpolations.

## 0.3.0 - 2026-08-12

- Add AST-aware JSX/TSX formatting for tags, props, fragments, expression containers, nested layout, and soft-width expansion.
- Normalize authored multiline arrays, calls, member chains, ternaries, callbacks, and parenthesized expressions without collapsing them.
- Prevent template-literal text from being interpreted as structural punctuation.
- Expand enclosing arrays in the same pass when nested formatting introduces multiline layout.
- Add versioned content caching with safe configuration and source-hash invalidation.
- Add debounced watch mode with project configuration and ignore reloads.
- Document CI, lint-script, and `lint-staged` integration patterns.

## 0.2.1 - 2026-08-12

- Fix JavaScript and TypeScript block indentation after template-literal interpolations.

## 0.2.0 - 2026-08-12

- Add `themis-ignore`, `themis-ignore-start`, and `themis-ignore-end` escape directives for JavaScript, TypeScript, CSS, and embedded Svelte scripts/styles.
- Add the first-party branded VS Code formatter with bundled and project-local engine resolution.
- Add CI coverage for Node.js 20, 22, and 24 and verified GitHub release artifacts.
- Add the Themis brand mark to npm, GitHub, and VS Code packages.

## 0.1.0 - 2026-08-11

- Publish the first public npm release with JavaScript, TypeScript, Svelte, CSS, and strict JSON engines.
- Add project configuration, ignore files, atomic writes, check mode, golden tests, syntax validation, and idempotence tests.
