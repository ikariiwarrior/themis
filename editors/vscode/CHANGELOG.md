# Changelog

## 0.4.9 - 2026-08-18

- Separate executable class members while keeping consecutive fields grouped.
- Preserve documentation-comment attachment and compact interface/type-literal members.

## 0.4.8 - 2026-08-18

- Add one empty line after inline TypeScript and TSX function, method, and control-flow opening braces.
- Exclude declaration containers, object literals, plain JavaScript, and next-line function braces from the new spacing rule.

## 0.4.7 - 2026-08-17

- Keep trailing TypeScript comments compact while structurally indenting global namespaces, interfaces, and nested object-shaped types.
- Preserve authored blank-line groups at TypeScript container boundaries and clean indentation-only blank lines.

## 0.4.6 - 2026-08-17

- Fix indentation for declarations and object-shaped types nested in TypeScript global and namespace bodies.
- Keep optional interface semicolons attached to their closing braces.

## 0.4.5 - 2026-08-17

- Keep JSDoc and ordinary comments attached to the code they document instead of moving preceding section spacing below the comment.

## 0.4.4 - 2026-08-17

- Preserve authored JavaScript and TypeScript statement grouping instead of inserting automatic blank lines between exports and other declaration kinds.
- Reserve automatic blank-line insertion for a concluding `return` statement, including in embedded Svelte scripts.

## 0.4.3 - 2026-08-17

- Keep related state and constant declarations grouped according to authored blank lines.
- Prevent repeated formatting from growing whitespace around implicitly closed Svelte and SVG elements.

## 0.4.2 - 2026-08-14

- Preserve authored import grouping instead of inserting a blank line between every import.
- Fix indentation for comments, objects, properties, and arrow bodies nested inside multiline arrays and function arguments.

## 0.4.1 - 2026-08-14

- Normalize first-statement and standalone-comment indentation in JavaScript, TypeScript, and embedded Svelte scripts.
- Preserve multiline comment content while applying the configured indentation baseline.

## 0.4.0 - 2026-08-13

- Format Svelte markup expressions, attributes, directives, special tags, and control blocks with stable AST-aware indentation.
- Preserve literal class contents and Tailwind ordering while expanding authored or width-pressured opening tags.
- Fix second-pass JavaScript/TypeScript width expansion and template-interpolation nesting discovered by the repository corpus.

## 0.3.0 - 2026-08-12

- Add first-class JSX/TSX layout and hardened multiline JavaScript/TypeScript indentation.
- Bundle the 0.3 engine with cache/watch-capable project tooling for CLI users.

## 0.2.1 - 2026-08-12

- Fix JavaScript and TypeScript block indentation after template-literal interpolations.

## 0.2.0 - 2026-08-12

- Add Themis branding and Marketplace presentation metadata.
- Add support for formatter escape directives in supported comment-bearing languages.
- Add packaged-bundle activation verification.

## 0.1.1 - 2026-08-12

- Fix extension activation by bundling dependency ESM entry points.

## 0.1.0 - 2026-08-11

- Add native document formatting and format-on-save for JavaScript, TypeScript, JSX, TSX, Svelte, CSS, Tailwind CSS language mode, and JSON.
