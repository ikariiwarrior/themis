const Module = require("node:module");
const path = require("node:path");

let formatterRegistered = false;
const vscode = {
    window: {
        createOutputChannel() {
            return { info() {}, error() {}, dispose() {} };
        },
    },
    workspace: {},
    languages: {
        registerDocumentFormattingEditProvider() {
            formatterRegistered = true;
            return { dispose() {} };
        },
    },
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === "vscode") return vscode;
    return originalLoad.call(this, request, parent, isMain);
};

try {
    const extension = require(path.resolve(__dirname, "../dist/extension.cjs"));
    extension.activate({ subscriptions: [] });
    if (!formatterRegistered) throw new Error("The extension loaded but did not register its formatting provider.");
    process.stdout.write("The bundled extension loads and registers its formatter.\n");
} finally {
    Module._load = originalLoad;
}
