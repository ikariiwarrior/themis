import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findLocalThemis, formatForEditor, languageFromVscode, minimalEdit } from "../src/formatter.js";

describe("VS Code language mapping", () => {
    it("maps editor identifiers to Themis language identifiers", () => {
        expect(languageFromVscode("javascriptreact")).toBe("jsx");
        expect(languageFromVscode("typescriptreact")).toBe("tsx");
        expect(languageFromVscode("svelte")).toBe("svelte");
        expect(languageFromVscode("tailwindcss")).toBe("css");
        expect(languageFromVscode("markdown")).toBeUndefined();
    });
});

describe("minimal editor edits", () => {
    it("returns one narrow replacement and nothing for unchanged text", () => {
        expect(minimalEdit("const x=1;\n", "const x = 1;\n")).toEqual({ start: 7, end: 8, text: " = " });
        expect(minimalEdit("same", "same")).toBeUndefined();
    });
});

describe("project integration", () => {
    it("formats with project configuration and respects ignored files", async () => {
        const root = await mkdtemp(join(tmpdir(), "themis-vscode-"));
        const sourceDirectory = join(root, "src");
        await mkdir(sourceDirectory);
        await writeFile(join(root, "themis.json"), JSON.stringify({ indent: { type: "tabs" } }));
        await writeFile(join(root, ".themisignore"), "src/ignored.ts\n");

        const filePath = join(sourceDirectory, "sample.ts");
        await writeFile(filePath, "if(ok){run();}\n");
        const formatted = await formatForEditor({
            source: "if(ok){run();}\n",
            languageId: "typescript",
            filePath,
            workspaceRoot: root,
            useLocalVersion: false,
            workspaceTrusted: true,
        });
        expect(formatted.output).toBe("if( ok ) {\n\n\trun();\n}\n");

        const ignoredPath = join(sourceDirectory, "ignored.ts");
        await writeFile(ignoredPath, "const x=1;\n");
        const ignored = await formatForEditor({
            source: "const x=1;\n",
            languageId: "typescript",
            filePath: ignoredPath,
            workspaceRoot: root,
            useLocalVersion: false,
            workspaceTrusted: true,
        });
        expect(ignored).toMatchObject({ output: "const x=1;\n", ignored: true });
    });

    it("finds a project-local formatter without crossing the workspace boundary", async () => {
        const root = await mkdtemp(join(tmpdir(), "themis-local-"));
        const nested = join(root, "packages", "app", "src");
        const packageDirectory = join(root, "node_modules", "@ikarii_warrior", "themis");
        await mkdir(nested, { recursive: true });
        await mkdir(join(packageDirectory, "dist"), { recursive: true });
        await writeFile(join(packageDirectory, "package.json"), JSON.stringify({ version: "9.9.9", main: "dist/index.js" }));
        await writeFile(join(packageDirectory, "dist", "index.js"), "export const format = value => value;\n");

        const local = await findLocalThemis(nested, root);
        expect(local?.version).toBe("9.9.9");
        expect(local?.entry).toBe(join(packageDirectory, "dist", "index.js"));
    });
});
