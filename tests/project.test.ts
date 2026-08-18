import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, optionsFromConfig } from "../src/project/config.js";
import { discoverFiles } from "../src/project/files.js";
import { runCli } from "../src/cli/run.js";
import { parseArgs } from "../src/cli/args.js";

const temporaryDirectories: string[] = [];

async function project(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "themis-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function capture(): { stream: Writable; text: () => string } {
  let value = "";
  return {
    stream: new Writable({ write(chunk, _encoding, callback) { value += chunk.toString(); callback(); } }),
    text: () => value,
  };
}

async function execute(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout = capture();
  const stderr = capture();
  const code = await runCli(args, { cwd, stdin: Readable.from([]), stdout: stdout.stream, stderr: stderr.stream });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

async function eventually(assertion: () => Promise<void>, timeout = 3000): Promise<void> {
  const started = Date.now();
  while (true) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() - started >= timeout) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

describe("project configuration", () => {
  it("discovers and validates themis.json from a parent directory", async () => {
    const root = await project();
    const nested = join(root, "src", "feature");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "themis.json"), JSON.stringify({ lineWidth: 100, indent: { type: "tabs", size: 4 } }));
    const loaded = await loadConfig(nested);
    expect(loaded.root).toBe(root);
    expect(optionsFromConfig(loaded.config)).toMatchObject({ lineWidth: 100, indent: "\t" });
  });

  it("rejects misspelled options instead of silently ignoring them", async () => {
    const root = await project();
    await writeFile(join(root, "themis.json"), JSON.stringify({ lineWidht: 100 }));
    await expect(loadConfig(root)).rejects.toThrow("unknown option: lineWidht");
  });
});

describe("file discovery", () => {
  it("handles directories and respects git, formatter, and configured ignores", async () => {
    const root = await project();
    await mkdir(join(root, "src", "generated"), { recursive: true });
    await writeFile(join(root, "src", "keep.ts"), "const x=1;");
    await writeFile(join(root, "src", "component.svelte"), "<script>const x=1;</script>");
    await writeFile(join(root, "src", "styles.css"), ".x{color:red}");
    await writeFile(join(root, "src", "data.json"), "{\"value\":1}");
    await writeFile(join(root, "src", "git-ignored.ts"), "const x=1;");
    await writeFile(join(root, "src", "formatter-ignored.ts"), "const x=1;");
    await writeFile(join(root, "src", "generated", "output.ts"), "const x=1;");
    await writeFile(join(root, ".gitignore"), "src/git-ignored.ts\n");
    await writeFile(join(root, ".themisignore"), "src/formatter-ignored.ts\n");

    const files = await discoverFiles(["src"], root, ["src/generated/"]);
    expect(files).toEqual([
      join(root, "src", "component.svelte"),
      join(root, "src", "data.json"),
      join(root, "src", "keep.ts"),
      join(root, "src", "styles.css"),
    ]);
  });
});

describe("multi-file CLI", () => {
  it("supports check, list-different, write, and a clean follow-up check", async () => {
    const root = await project();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "a.ts"), "const a=1;\n");
    await writeFile(join(root, "src", "b.ts"), "const b = 2;\n");

    const check = await execute(root, ["--check", "src"]);
    expect(check).toMatchObject({ code: 1, stderr: "1 file would be reformatted.\n" });

    const listed = await execute(root, ["--list-different", "src"]);
    expect(listed).toMatchObject({ code: 1, stdout: "src/a.ts\n" });

    const written = await execute(root, ["--write", "src"]);
    expect(written).toMatchObject({ code: 0, stdout: "Formatted 1 file; 1 unchanged.\n" });
    expect(await readFile(join(root, "src", "a.ts"), "utf8")).toBe("const a = 1;\n");
    expect((await execute(root, ["--check", "src"])).code).toBe(0);
  });

  it("preflights all inputs and writes nothing when one file cannot parse", async () => {
    const root = await project();
    await writeFile(join(root, "good.ts"), "const good=1;\n");
    await writeFile(join(root, "bad.ts"), "const = ;\n");

    const result = await execute(root, ["--write", "*.ts"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("No files were written");
    expect(await readFile(join(root, "good.ts"), "utf8")).toBe("const good=1;\n");
  });

  it("applies indentation from themis.json", async () => {
    const root = await project();
    await writeFile(join(root, "themis.json"), JSON.stringify({ indent: { type: "tabs", size: 4 } }));
    await writeFile(join(root, "sample.ts"), "if(ok){run();}\n");
    expect((await execute(root, ["sample.ts"])).stdout).toBe("if( ok ) {\n\trun();\n}\n");
  });

  it("supports opinion.json as a compatibility alias", async () => {
    const root = await project();
    await writeFile(join(root, "opinion.json"), JSON.stringify({ lineWidth: 88 }));
    const loaded = await loadConfig(root);
    expect(loaded.path).toBe(join(root, "opinion.json"));
    expect(loaded.config.lineWidth).toBe(88);
  });

  it("caches clean files and invalidates changed files", async () => {
    const root = await project();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "a.ts"), "const a=1;\n");
    await writeFile(join(root, "src", "b.ts"), "const b=2;\n");

    const first = await execute(root, ["--write", "--cache", "src"]);
    expect(first.stdout).toBe("Formatted 2 files; 0 unchanged.\n");
    expect(JSON.parse(await readFile(join(root, ".themis-cache"), "utf8"))).toMatchObject({ schema: 1, formatterVersion: "0.4.7" });

    const second = await execute(root, ["--write", "--cache", "src"]);
    expect(second.stdout).toBe("Formatted 0 files; 0 unchanged; 2 cached.\n");

    await writeFile(join(root, "src", "a.ts"), "const a=3;\n");
    const third = await execute(root, ["--write", "--cache", "src"]);
    expect(third.stdout).toBe("Formatted 1 file; 0 unchanged; 1 cached.\n");
  });

  it("supports a nested cache location without formatting the cache as JSON", async () => {
    const root = await project();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "sample.ts"), "const sample=1;\n");

    const first = await execute(root, ["--write", "--cache-location", "src/.cache/themis.json", "src"]);
    expect(first.code).toBe(0);
    expect(JSON.parse(await readFile(join(root, "src", ".cache", "themis.json"), "utf8"))).toMatchObject({ schema: 1 });
    const second = await execute(root, ["--write", "--cache-location", "src/.cache/themis.json", "src"]);
    expect(second.stdout).toBe("Formatted 0 files; 0 unchanged; 1 cached.\n");
  });

  it("does not save a cache or write files after a parse failure", async () => {
    const root = await project();
    await writeFile(join(root, "good.ts"), "const good=1;\n");
    await writeFile(join(root, "bad.ts"), "const = ;\n");

    expect((await execute(root, ["--write", "--cache", "*.ts"])).code).toBe(2);
    await expect(readFile(join(root, ".themis-cache"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(root, "good.ts"), "utf8")).toBe("const good=1;\n");
  });

  it("watches supported files and reloads project configuration", async () => {
    const root = await project();
    await mkdir(join(root, "src"));
    const sample = join(root, "src", "sample.ts");
    await writeFile(sample, "if(ok){run();}\n");
    const stdout = capture();
    const stderr = capture();
    const controller = new AbortController();
    const watching = runCli(["--write", "--watch", "--cache", "src"], {
      cwd: root,
      stdin: Readable.from([]),
      stdout: stdout.stream,
      stderr: stderr.stream,
      signal: controller.signal,
    });

    await eventually(async () => expect(stdout.text()).toContain("Watching"));
    await writeFile(sample, "if(ready){run();}\n");
    await eventually(async () => expect(await readFile(sample, "utf8")).toBe("if( ready ) {\n    run();\n}\n"));

    await writeFile(join(root, "themis.json"), JSON.stringify({ indent: { type: "tabs", size: 4 } }));
    await eventually(async () => expect(await readFile(sample, "utf8")).toBe("if( ready ) {\n\trun();\n}\n"));
    controller.abort();
    expect(await watching).toBe(0);
    expect(stderr.text()).toBe("");
  });
});

describe("workflow CLI arguments", () => {
  it("requires safe modes for cache and watch", () => {
    expect(() => parseArgs(["--cache", "sample.ts"])).toThrow("--cache requires");
    expect(() => parseArgs(["--watch", "sample.ts"])).toThrow("--watch requires --write");
    expect(parseArgs(["--write", "--watch", "--cache-location", ".cache/themis", "src"])).toMatchObject({
      mode: "write",
      watch: true,
      cache: true,
      cacheLocation: ".cache/themis",
    });
  });
});
