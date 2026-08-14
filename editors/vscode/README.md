# Themis for Visual Studio Code

<p align="center">
    <img src="images/themis-mark.png" alt="Themis mark" width="180">
</p>

This extension makes Themis a native Visual Studio Code formatter for JavaScript, TypeScript, JSX, TSX, Svelte, CSS (including the Tailwind CSS language mode), and JSON.

The extension contains a bundled formatter, so it works without a global or project installation. In trusted workspaces it prefers a project-local `@ikarii_warrior/themis` dependency when one is available, allowing teams to pin the CLI, CI, and editor to the same version. Set `themis.useLocalVersion` to `false` to always use the bundled engine.

## Format on save

Add this to `.vscode/settings.json`:

```json
{
    "editor.formatOnSave": true,
    "[javascript][javascriptreact][typescript][typescriptreact][svelte][css][tailwindcss][json]": {
        "editor.defaultFormatter": "ikarii.themis-formatter"
    }
}
```

The extension discovers `themis.json` and `.themisignore` exactly like the CLI. `themis.configPath` may select an explicit configuration file relative to the workspace folder.

Invalid syntax and invalid configuration are reported without changing the document. Ignored files are left untouched.

`// themis-ignore`, `// themis-ignore-start`, and `// themis-ignore-end` preserve targeted JavaScript/TypeScript syntax. CSS uses equivalent `/* ... */` directives. They also work in supported Svelte script and style regions.

## Local installation

Build and install the VSIX from the repository root:

```sh
npm run vscode:install
npm run vscode:package
code --install-extension editors/vscode/dist/themis-vscode-0.4.1.vsix
```
