import { afterAll } from "bun:test";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function temporaryDirectory(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

export function checkProcess(result: ReturnType<typeof Bun.spawnSync>): void {
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() + result.stdout.toString());
  }
}

/** Load checkout patch constants without depending on Python's working directory. */
export function patchModule(patcher: string, code: string, args: string[] = []) {
  return Bun.spawnSync(["python3", "-B", "-c", `
import json, pathlib, runpy, sys
sys.path.insert(0, str(pathlib.Path(sys.argv[1]).resolve().parent))
m = runpy.run_path(sys.argv[1])
${code}
`, patcher, ...args]);
}

export function applySdkPatches(root: string, names: string[]): void {
  for (const name of names) {
    const patcher = fileURLToPath(new URL(`../../patches/${name}.py`, import.meta.url));
    checkProcess(Bun.spawnSync(["python3", "-B", patcher], {
      env: { ...process.env, PI_SDK_ROOT: root, HOME: root },
    }));
  }
}

export function describePatch<T>(patcher: string, expression: string, setup = ""): T {
  const result = patchModule(patcher, `${setup}\nprint(json.dumps(${expression}))`);
  checkProcess(result);
  return JSON.parse(result.stdout.toString());
}

/** Minimal package fixture for patchers whose entrypoint discovers sources via HOME. */
export function copyPowerline(home: string, source: string, files: string[], patch: string): string {
  const target = join(home, ".pi/agent/git/github.com/nicobailon/pi-powerline-footer");
  for (const file of files) {
    mkdirSync(dirname(join(target, file)), { recursive: true });
    copyFileSync(join(source, file), join(target, file));
  }
  checkProcess(Bun.spawnSync(["python3", "-B", patch], { env: { ...process.env, HOME: home } }));
  return target;
}

/** Copy package sources, not dependencies or git history. Dependencies stay read-only. */
export function copyPackageSources(source: string, target: string): void {
  cpSync(source, target, {
    recursive: true,
    filter: path => !["node_modules", ".git"].includes(path.slice(source.length + 1).split("/")[0]),
  });
}

/** Own both host and TUI sources: checkout host patches must never follow a live symlink. */
export function copySdk(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  cpSync(join(source, "dist"), join(target, "dist"), { recursive: true });
  copyFileSync(join(source, "package.json"), join(target, "package.json"));
  const modules = join(source, "node_modules");
  for (const entry of readdirSync(modules)) {
    const names = entry.startsWith("@")
      ? readdirSync(join(modules, entry)).map(name => join(entry, name))
      : [entry];
    for (const name of names) {
      const destination = join(target, "node_modules", name);
      mkdirSync(dirname(destination), { recursive: true });
      if (name === "@earendil-works/pi-tui") copyPackageSources(join(modules, name), destination);
      else symlinkSync(resolve(modules, name), destination);
    }
  }
}
