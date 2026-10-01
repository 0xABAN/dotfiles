import { afterAll, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "configs-installer-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const installer = new URL("../../../install.sh", import.meta.url);

function sandbox(name: string) {
  const cwd = join(root, name);
  const home = join(cwd, "home");
  const bin = join(cwd, "bin");
  mkdirSync(join(cwd, "pi/agent"), { recursive: true });
  mkdirSync(home);
  mkdirSync(bin);
  copyFileSync(installer, join(cwd, "install.sh"));
  writeFileSync(join(cwd, "pi/agent/mcp.json.example"), "{}\n");
  // Launcher mechanics have separate tests; this fixture proves replay ordering.
  writeFileSync(join(cwd, "pi/launcher.py"), `from pathlib import Path
with (Path.home() / "patch-order.log").open("a") as log:
    log.write("launcher.py\\n")
`);
  // Keep this installer test offline; assert the exact clone request and provide its output.
  writeFileSync(join(bin, "git"), `#!/bin/sh
set -eu
[ "$1" = clone ]
[ "$2" = https://github.com/0xABAN/pi-extensions.git ]
[ "$3" = "$HOME/dev/pi-extensions" ]
echo clone >> "$HOME/clone.log"
mkdir -p "$3/inline-skills" "$3/dj"
echo '{}' > "$3/inline-skills/package.json"
echo '{}' > "$3/dj/package.json"
`);
  chmodSync(join(bin, "git"), 0o755);
  writeFileSync(join(bin, "bun"), `#!/bin/sh
set -eu
[ "$PWD" = "$HOME/dev/pi-extensions" ]
[ "$*" = 'install --frozen-lockfile --ignore-scripts' ]
echo install >> "$HOME/dependencies.log"
exit "\${FAIL_DEPENDENCIES:-0}"
`);
  chmodSync(join(bin, "bun"), 0o755);
  writeFileSync(join(bin, "pi"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const run = (env: Record<string, string> = {}) => Bun.spawnSync(["bash", "install.sh"], {
    cwd, env: { ...process.env, ...env, HOME: home, PATH: `${bin}:${env.PATH ?? process.env.PATH}` },
  });
  return { cwd, home, run };
}

test("installer provisions missing extensions and never reclones an existing checkout", () => {
  const { cwd, home, run } = sandbox("fresh");
  expect(run().exitCode).toBe(0);
  for (const theme of ["osaka-jade", "everforest-dark-medium"]) {
    expect(readlinkSync(join(home, ".config/ghostty/themes", theme))).toBe(join(realpathSync(cwd), "ghostty/themes", theme));
  }
  const checkout = join(home, "dev/pi-extensions");
  expect(existsSync(join(checkout, "inline-skills/package.json"))).toBe(true);
  expect(existsSync(join(checkout, "dj/package.json"))).toBe(true);
  writeFileSync(join(checkout, "local-work.txt"), "keep my edits");
  expect(run().exitCode).toBe(0);
  expect(readFileSync(join(home, "clone.log"), "utf8")).toBe("clone\n");
  expect(readFileSync(join(home, "dependencies.log"), "utf8")).toBe("install\ninstall\n");
  expect(readFileSync(join(checkout, "local-work.txt"), "utf8")).toBe("keep my edits");
});

test("installer requires DJ even when inline-skills is already present", () => {
  const { home, run } = sandbox("missing-dj");
  const checkout = join(home, "dev/pi-extensions");
  mkdirSync(join(checkout, "inline-skills"), { recursive: true });
  writeFileSync(join(checkout, "inline-skills/package.json"), "{}");
  writeFileSync(join(home, ".zshrc"), "original");
  const result = run();
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("dj/package.json");
  expect(readFileSync(join(home, ".zshrc"), "utf8")).toBe("original");
  expect(existsSync(join(home, "dependencies.log"))).toBe(false);
});

test("dependency installation failure leaves existing config links untouched", () => {
  const { home, run } = sandbox("failed-dependencies");
  writeFileSync(join(home, ".zshrc"), "original");
  expect(run({ FAIL_DEPENDENCIES: "1" }).exitCode).toBe(1);
  expect(readFileSync(join(home, ".zshrc"), "utf8")).toBe("original");
});

test("installer runs the Pi patches and surfaces incompatible installations", () => {
  for (const name of ["powerline-dj.py", "powerline-layout.py", "powerline-compaction-queue.py", "pi-horizontal-inset.py", "powerline-editor.py", "pi-transcript.py", "intercom-ui.py", "pi-extension-dialogs.py", "pi-activity-notices.py", "pi-compact-layout.py", "pi-compaction-queue.py", "rpiv-todo-ui.py", "subagents-ui.py"]) {
    const { cwd, run } = sandbox(name);
    const patches = join(cwd, "pi/agent/patches");
    mkdirSync(patches);
    writeFileSync(join(patches, name), "raise SystemExit(23)\n");
    expect(run().exitCode).toBe(23);
  }
}, 15_000); // Separate installer processes can exceed Bun's 5s default under load.

test("activity styling runs after legacy todo tweaks", () => {
  const { cwd, home, run } = sandbox("activity-order");
  const patches = join(cwd, "pi/agent/patches");
  mkdirSync(patches);
  const names = ["powerline-compaction-queue.py", "pi-transcript.py", "intercom-ui.py", "pi-extension-dialogs.py", "pi-activity-notices.py", "pi-compact-layout.py", "pi-compaction-queue.py", "rpiv-todo-gray.py", "rpiv-todo-ui.py", "subagents-ui.py"];
  for (const name of names) {
    writeFileSync(join(patches, name), `from pathlib import Path
with (Path.home() / "patch-order.log").open("a") as log:
    log.write("${name}\\n")
`);
  }
  expect(run().exitCode).toBe(0);
  expect(readFileSync(join(home, "patch-order.log"), "utf8")).toBe([...names, "launcher.py"].join("\n") + "\n");
});

test("installer skips launcher selection when Pi is absent", () => {
  const { cwd, home, run } = sandbox("no-pi");
  const bin = join(cwd, "bin");
  rmSync(join(bin, "pi"));
  // Include only installer utilities, never a Pi from the developer's PATH.
  for (const name of ["bash", "date", "dirname", "mkdir", "ln", "mv", "rm", "cp"]) {
    symlinkSync(Bun.which(name)!, join(bin, name));
  }
  const result = run({ PATH: "" });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("Pi not installed; skipping launcher selection");
  expect(existsSync(join(home, "patch-order.log"))).toBe(false);
});

test("installer propagates launcher refusal", () => {
  const { cwd, run } = sandbox("launcher-refusal");
  writeFileSync(join(cwd, "pi/launcher.py"), "raise SystemExit(24)\n");
  expect(run().exitCode).toBe(24);
});

test("DJ has a single source and its legacy auto-discovered copy is removed", () => {
  const settings = JSON.parse(readFileSync(new URL("../settings.json", import.meta.url), "utf8"));
  expect(settings.packages.filter((entry: unknown) => entry === "../../dev/pi-extensions/dj")).toHaveLength(1);
  expect(existsSync(new URL("../extensions/agent-dj.ts", import.meta.url))).toBe(false);
});

test("installer rejects an outdated checkout before changing existing configs", () => {
  const { home, run } = sandbox("outdated");
  mkdirSync(join(home, "dev/pi-extensions"), { recursive: true });
  writeFileSync(join(home, ".zshrc"), "original");
  const result = run();
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("update the checkout");
  expect(readFileSync(join(home, ".zshrc"), "utf8")).toBe("original");
  expect(existsSync(join(home, "clone.log"))).toBe(false);
});
