# Changelog

All notable changes to Themis are recorded here.

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
