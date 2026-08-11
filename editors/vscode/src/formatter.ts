import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
    discoverFiles,
    format as bundledFormat,
    loadConfig,
    optionsFromConfig,
    type FormatOptions,
    type LanguageId,
} from "@ikarii_warrior/themis";

export interface FormatterModule {
    format(source: string, options: Partial<FormatOptions>): string;
}

export interface EditorFormatRequest {
    source: string;
    languageId: string;
    filePath?: string;
    workspaceRoot?: string;
    configPath?: string;
    useLocalVersion: boolean;
    workspaceTrusted: boolean;
}

export interface EditorFormatResult {
    output: string;
    ignored: boolean;
    engine: "bundled" | "local";
    engineVersion?: string;
}

export interface MinimalEdit {
    start: number;
    end: number;
    text: string;
}

interface LocalThemis {
    entry: string;
    version?: string;
}

const bundledModule: FormatterModule = { format: bundledFormat };

export function languageFromVscode(languageId: string): LanguageId | undefined {
    switch (languageId) {
        case "javascript": return "javascript";
        case "javascriptreact": return "jsx";
        case "typescript": return "typescript";
        case "typescriptreact": return "tsx";
        case "svelte": return "svelte";
        case "css": return "css";
        case "tailwindcss": return "css";
        case "json": return "json";
        default: return undefined;
    }
}

export function minimalEdit(original: string, formatted: string): MinimalEdit | undefined {
    if (original === formatted) return undefined;

    let start = 0;
    const sharedLength = Math.min(original.length, formatted.length);
    while (start < sharedLength && original[start] === formatted[start]) start++;

    let originalEnd = original.length;
    let formattedEnd = formatted.length;
    while (originalEnd > start && formattedEnd > start && original[originalEnd - 1] === formatted[formattedEnd - 1]) {
        originalEnd--;
        formattedEnd--;
    }

    return { start, end: originalEnd, text: formatted.slice(start, formattedEnd) };
}

async function exists(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isFile();
    } catch {
        return false;
    }
}

export async function findLocalThemis(startPath: string, workspaceRoot: string): Promise<LocalThemis | undefined> {
    const boundary = resolve(workspaceRoot);
    let directory = resolve(startPath);
    if (parse(directory).root === directory && directory !== boundary) return undefined;

    while (true) {
        const packageDirectory = join(directory, "node_modules", "@ikarii_warrior", "themis");
        const packagePath = join(packageDirectory, "package.json");
        if (await exists(packagePath)) {
            const manifest = JSON.parse(await readFile(packagePath, "utf8")) as { main?: unknown; version?: unknown };
            const main = typeof manifest.main === "string" ? manifest.main : "dist/index.js";
            const entry = resolve(packageDirectory, main);
            if (!await exists(entry)) throw new Error(`The local Themis package has no formatter entry point at ${entry}.`);
            return { entry, version: typeof manifest.version === "string" ? manifest.version : undefined };
        }

        if (directory === boundary) return undefined;
        const parent = dirname(directory);
        if (parent === directory || !directory.startsWith(`${boundary}\\`) && !directory.startsWith(`${boundary}/`)) return undefined;
        directory = parent;
    }
}

async function importLocalThemis(local: LocalThemis): Promise<FormatterModule> {
    const imported = await import(pathToFileURL(local.entry).href) as Partial<FormatterModule>;
    if (typeof imported.format !== "function") {
        throw new Error(`The local Themis package at ${local.entry} does not export format().`);
    }
    return imported as FormatterModule;
}

export async function formatForEditor(request: EditorFormatRequest): Promise<EditorFormatResult> {
    const language = languageFromVscode(request.languageId);
    if (!language) throw new Error(`Themis does not support the ${request.languageId} language.`);

    let options: Partial<FormatOptions> = { language };
    if (request.filePath) {
        const configBase = request.workspaceRoot ?? dirname(request.filePath);
        const explicitConfig = request.configPath
            ? isAbsolute(request.configPath) ? request.configPath : resolve(configBase, request.configPath)
            : undefined;
        const loaded = await loadConfig(dirname(request.filePath), explicitConfig);
        const included = await discoverFiles([request.filePath], loaded.root, loaded.config.ignore, loaded.root);
        if (included.length === 0) {
            return { output: request.source, ignored: true, engine: "bundled" };
        }
        options = { ...optionsFromConfig(loaded.config), language };
    }

    if (request.useLocalVersion && request.workspaceTrusted && request.filePath && request.workspaceRoot) {
        const local = await findLocalThemis(dirname(request.filePath), request.workspaceRoot);
        if (local) {
            const module = await importLocalThemis(local);
            return {
                output: module.format(request.source, options),
                ignored: false,
                engine: "local",
                engineVersion: local.version,
            };
        }
    }

    return { output: bundledModule.format(request.source, options), ignored: false, engine: "bundled" };
}
