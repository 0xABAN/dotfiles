import { expect, spyOn } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { copySdk, describePatch, temporaryDirectory } from "./support/patch_fixtures";
import { nativeSuite } from "./support/native_suite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const patcher = fileURLToPath(new URL("../patches/pi_activity_notices.py", import.meta.url));
const { HOST, MODULE, EDITS, PACKAGE_UPDATE_CHECK, PACKAGE_UPDATE_CHECK_DISABLED, LEGACY_PACKAGE_UPDATE_NOTICE, LEGACY_GRAY_PACKAGE_UPDATE_NOTICE } = describePatch<{
  HOST: string;
  MODULE: string;
  EDITS: [string, string][];
  PACKAGE_UPDATE_CHECK: string;
  PACKAGE_UPDATE_CHECK_DISABLED: string;
  LEGACY_PACKAGE_UPDATE_NOTICE: string;
  LEGACY_GRAY_PACKAGE_UPDATE_NOTICE: string;
}>(patcher, "{k:m[k] for k in ('HOST','MODULE','EDITS','PACKAGE_UPDATE_CHECK','PACKAGE_UPDATE_CHECK_DISABLED','LEGACY_PACKAGE_UPDATE_NOTICE','LEGACY_GRAY_PACKAGE_UPDATE_NOTICE')}");
const temp = temporaryDirectory("pi-activity-notices-");
const sdk = process.env.PI_SDK_ROOT;
const { unitTest: test, nativeTest: realTest } = nativeSuite(import.meta.path, !!sdk);
const run = (root: string) => Bun.spawnSync(["python3", "-B", patcher], { env: { ...process.env, PI_SDK_ROOT: root, HOME: root } });
const contents = (root: string) => [HOST, MODULE].map(file => existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : null);
function fixture(name: string) {
  const root = join(temp, name);
  mkdirSync(dirname(join(root, MODULE)), { recursive: true });
  writeFileSync(join(root, "package.json"), '{"version":"0.87.1","type":"module"}');
  writeFileSync(join(root, HOST), PACKAGE_UPDATE_CHECK + "\n" + EDITS.map(([old]) => old).join("\n") + "\n// unrelated host work\n");
  return root;
}

test("notices validate every anchor, back up exact originals and reapply without writes", () => {
  const root = fixture("valid");
  const before = contents(root);
  expect(run(root).exitCode).toBe(0);
  const after = contents(root);
  const backups = join(root, ".config/theme-backups");
  const names = readdirSync(backups);
  expect(names).toHaveLength(1);
  expect(readFileSync(join(backups, names[0], HOST), "utf8")).toBe(before[0]!);
  expect(JSON.parse(readFileSync(join(backups, names[0], "added-files.json"), "utf8"))).toEqual([MODULE]);
  expect(after[0]).toContain("// unrelated host work");
  expect(run(root).exitCode).toBe(0);
  expect(contents(root)).toEqual(after);
  expect(readdirSync(backups)).toEqual(names);
});

test("notices reject partial, duplicate and changed sources without writes", () => {
  for (const state of ["version", "duplicate", "partial", "modified", "missing", "unexpected"]) {
    const root = fixture(state);
    if (state === "version") writeFileSync(join(root, "package.json"), '{"version":"0.85.0"}');
    else if (state === "duplicate") writeFileSync(join(root, HOST), contents(root)[0] + EDITS[0][0]);
    else if (state === "partial") writeFileSync(join(root, HOST), contents(root)[0]!.replace(...EDITS[0]));
    else if (state === "unexpected") writeFileSync(join(root, MODULE), "unrelated helper");
    else {
      expect(run(root).exitCode).toBe(0);
      if (state === "missing") rmSync(join(root, MODULE));
      else writeFileSync(join(root, MODULE), "modified helper");
    }
    const before = contents(root);
    expect(run(root).exitCode).not.toBe(0);
    expect(contents(root)).toEqual(before);
  }
  expect(run(join(temp, "absent")).exitCode).toBe(0);
});

test("existing notices disable package checks and refuse changed check methods", () => {
  const root = fixture("existing-notices");
  expect(run(root).exitCode).toBe(0);
  const path = join(root, HOST);
  const patched = readFileSync(path, "utf8");
  writeFileSync(path, patched.replace(PACKAGE_UPDATE_CHECK_DISABLED, PACKAGE_UPDATE_CHECK));
  expect(run(root).exitCode).toBe(0);
  expect(readFileSync(path, "utf8")).toBe(patched);

  for (const check of [PACKAGE_UPDATE_CHECK + PACKAGE_UPDATE_CHECK, PACKAGE_UPDATE_CHECK.replace("PI_OFFLINE", "CUSTOM_OFFLINE"), PACKAGE_UPDATE_CHECK + PACKAGE_UPDATE_CHECK_DISABLED]) {
    writeFileSync(path, patched.replace(PACKAGE_UPDATE_CHECK_DISABLED, check));
    const before = contents(root);
    expect(run(root).exitCode).not.toBe(0);
    expect(contents(root)).toEqual(before);
  }
});

test("the exact previous notice helper upgrades without marking it as newly added", () => {
  const root = fixture("legacy-helper");
  expect(run(root).exitCode).toBe(0);
  const before = readdirSync(join(root, ".config/theme-backups"));
  const legacy = readFileSync(new URL("../patches/payloads/host/legacy/activity_notice.js.inc", import.meta.url), "utf8");
  writeFileSync(join(root, MODULE), legacy);
  expect(run(root).exitCode).toBe(0);
  const backups = join(root, ".config/theme-backups");
  const added = readdirSync(backups).filter(name => !before.includes(name));
  expect(added).toHaveLength(1);
  expect(readFileSync(join(backups, added[0], MODULE), "utf8")).toBe(legacy);
  expect(JSON.parse(readFileSync(join(backups, added[0], "added-files.json"), "utf8"))).toEqual([]);
  const after = contents(root);
  expect(run(root).exitCode).toBe(0);
  expect(contents(root)).toEqual(after);
});

test("the previous bordered package notice migrates to a gray background", () => {
  const root = fixture("legacy-package-borders");
  expect(run(root).exitCode).toBe(0);
  const path = join(root, HOST);
  const current = readFileSync(path, "utf8");
  writeFileSync(path, current.replace(EDITS.at(-1)![1], LEGACY_PACKAGE_UPDATE_NOTICE));
  expect(run(root).exitCode).toBe(0);
  const after = contents(root)[0]!;
  expect(after).toContain('theme.bg("userMessageBg", text)');
  expect(after).not.toContain('new DynamicBorder((text) => theme.fg("toolOutput", text))');
  expect(run(root).exitCode).toBe(0);
  expect(contents(root)[0]).toBe(after);
});

test("the previous gray package notice migrates to padded rows", () => {
  const root = fixture("legacy-package-gray");
  expect(run(root).exitCode).toBe(0);
  const path = join(root, HOST);
  const current = readFileSync(path, "utf8");
  writeFileSync(path, current.replace(EDITS.at(-1)![1], LEGACY_GRAY_PACKAGE_UPDATE_NOTICE));
  expect(run(root).exitCode).toBe(0);
  expect(contents(root)[0]).toContain('theme.bg("userMessageBg", text)');
  expect(contents(root)[0]).toContain(", 1, 1, (text) =>");
});

realTest("native notices align every wrapped line and preserve coalescing, warnings and errors", async () => {
  const root = join(temp, "real");
  copySdk(sdk!, root);
  const result = run(root);
  if (result.exitCode) throw new Error(result.stderr.toString());
  const { InteractiveMode } = await import(pathToFileURL(join(root, HOST)).href);
  const tui = await import(pathToFileURL(join(root, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);
  const colors = await import(pathToFileURL(join(root, "dist/modes/interactive/theme/theme.js")).href);
  colors.setThemeInstance(colors.loadThemeFromPath(fileURLToPath(new URL("../themes/osaka-jade.json", import.meta.url)), "truecolor"));
  const app = Object.create(InteractiveMode.prototype);

  // No startup network lookup, even online; the package manager remains usable
  // by the explicit update command. Restore the stub before other native checks.
  const { DefaultPackageManager } = await import(pathToFileURL(join(root, "dist/core/package-manager.js")).href);
  const lookup = spyOn(DefaultPackageManager.prototype, "checkForAvailableUpdates")
    .mockResolvedValue([{ displayName: "fixture-package" }]);
  const offline = process.env.PI_OFFLINE;
  delete process.env.PI_OFFLINE;
  app.runtimeHost = { session: { sessionManager: { getCwd: () => root } } };
  try {
    expect(await app.checkForPackageUpdates()).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  } finally {
    lookup.mockRestore();
    if (offline === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = offline;
  }

  app.chatContainer = new tui.Container();
  app.ui = { requestRender() {} };
  app.outputPad = 1;
  app.showExtensionNotify("◇ Todos\n╰─ ◈ This task has a long subject 漢字 é and active form", "info");
  const first = app.lastStatusText;
  for (const width of [4, 8, 20, 80]) {
    const padding = Math.min(width < 80 ? 1 : 3, Math.max(0, Math.floor((width - 2) / 2)));
    const lines = first.render(width);
    for (const line of lines) {
      expect(tui.visibleWidth(line)).toBeLessThanOrEqual(width);
      expect(tui.stripTerminalSequences(line)).toStartWith(" ".repeat(padding));
    }
  }
  expect(first.render(20).length).toBeGreaterThan(3);
  app.showExtensionNotify("◇ Todos cleared", "info");
  expect(app.lastStatusText).toBe(first);
  expect(app.chatContainer.children).toHaveLength(2);
  expect(first.render(80).map(tui.stripTerminalSequences).join("\n")).toContain("   ◇ Todos cleared");
  app.outputPad = 3;
  expect(tui.stripTerminalSequences(first.render(80)[0])).toStartWith("     ◇ Todos cleared");
  for (const type of ["warning", "error"]) {
    app.showExtensionNotify("Detail preserved", type);
    const notice = app.chatContainer.children.at(-1);
    const line = notice.render(80)[0];
    expect(line).toContain(colors.theme.getFgAnsi(type));
    expect(tui.stripTerminalSequences(line)).toContain(type === "error" ? "Error: Detail preserved" : "Warning: Detail preserved");
  }
  expect(app.chatContainer.children).toHaveLength(6);
  app.showExtensionNotify("new status after error", "info");
  expect(app.chatContainer.children).toHaveLength(8);
  // Package updates are informational; reuse cream without recoloring warnings.
  app.chatContainer = new tui.Container();
  app.showPackageUpdateNotification(["fixture-package"]);
  const updateLines = app.chatContainer.render(100);
  const heading = updateLines.find((line: string) => line.includes("Package Updates Available"));
  expect(heading).toContain(colors.theme.getFgAnsi("toolOutput"));
  const borders = updateLines.filter((line: string) => /^─+$/.test(tui.stripTerminalSequences(line).trim()));
  expect(borders).toHaveLength(0);
  const background = colors.theme.getBgAnsi("userMessageBg");
  const backgroundLines = updateLines.filter((line: string) => line.includes(background));
  expect(backgroundLines).toHaveLength(6);
  expect(tui.stripTerminalSequences(backgroundLines[0]).trim()).toBe("");
  expect(tui.stripTerminalSequences(backgroundLines.at(-1)).trim()).toBe("");
  expect(heading).toContain(background);
  expect(updateLines.find((line: string) => tui.stripTerminalSequences(line).includes("fixture-package"))).toContain(background);
  expect(updateLines.join("\n")).not.toContain(colors.theme.getFgAnsi("warning"));
  expect(updateLines.map(tui.stripTerminalSequences).join("\n")).toContain("fixture-package");

  // The added import/notice anchors must coexist with the existing transcript patch.
  const transcript = Bun.spawnSync(["python3", "-B", fileURLToPath(new URL("../patches/pi_transcript.py", import.meta.url))], {
    env: { ...process.env, PI_SDK_ROOT: root, HOME: root },
  });
  expect(transcript.exitCode).toBe(0);
});
