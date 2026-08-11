import * as vscode from "vscode";
import { formatForEditor, minimalEdit } from "./formatter.js";

const supportedDocuments: vscode.DocumentSelector = [
    { language: "javascript", scheme: "file" },
    { language: "javascript", scheme: "untitled" },
    { language: "javascriptreact", scheme: "file" },
    { language: "javascriptreact", scheme: "untitled" },
    { language: "typescript", scheme: "file" },
    { language: "typescript", scheme: "untitled" },
    { language: "typescriptreact", scheme: "file" },
    { language: "typescriptreact", scheme: "untitled" },
    { language: "svelte", scheme: "file" },
    { language: "svelte", scheme: "untitled" },
    { language: "css", scheme: "file" },
    { language: "css", scheme: "untitled" },
    { language: "tailwindcss", scheme: "file" },
    { language: "tailwindcss", scheme: "untitled" },
    { language: "json", scheme: "file" },
    { language: "json", scheme: "untitled" },
];

export function activate(context: vscode.ExtensionContext): void {
    const output = vscode.window.createOutputChannel("Themis", { log: true });
    context.subscriptions.push(output);

    const provider: vscode.DocumentFormattingEditProvider = {
        async provideDocumentFormattingEdits(document): Promise<vscode.TextEdit[]> {
            const configuration = vscode.workspace.getConfiguration("themis", document.uri);
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            const filePath = document.uri.scheme === "file" ? document.uri.fsPath : undefined;

            try {
                const result = await formatForEditor({
                    source: document.getText(),
                    languageId: document.languageId,
                    filePath,
                    workspaceRoot: workspaceFolder?.uri.fsPath,
                    configPath: configuration.get<string>("configPath", "").trim() || undefined,
                    useLocalVersion: configuration.get<boolean>("useLocalVersion", true),
                    workspaceTrusted: vscode.workspace.isTrusted,
                });

                if (result.ignored) {
                    output.info(`Ignored ${document.uri.fsPath || document.uri.toString()}`);
                    return [];
                }

                const edit = minimalEdit(document.getText(), result.output);
                if (!edit) return [];

                const version = result.engineVersion ? ` ${result.engineVersion}` : "";
                output.info(`Formatted ${document.uri.fsPath || document.uri.toString()} with ${result.engine}${version} Themis.`);
                return [vscode.TextEdit.replace(
                    new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
                    edit.text,
                )];
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                output.error(`Unable to format ${document.uri.fsPath || document.uri.toString()}: ${message}`);
                void vscode.window.showErrorMessage(`Themis could not format this document: ${message}`);
                return [];
            }
        },
    };

    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(supportedDocuments, provider));
}

export function deactivate(): void {}
