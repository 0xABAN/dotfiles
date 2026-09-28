import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkProcess, copySdk, describePatch, temporaryDirectory } from "./support/patch-fixtures";
import { nativeSuite } from "./support/native-suite";

const patcher = fileURLToPath(new URL("../patches/pi-compact-layout.py", import.meta.url));
const { HOST, VIEWPORT, VIEWPORT_ANCHOR, MODULE, EDITS, LEGACY_EDITS } = describePatch<{
  HOST: string; VIEWPORT: string; MODULE: string;
  VIEWPORT_ANCHOR: string; EDITS: [string, string, number][]; LEGACY_EDITS: [string, string, number][];
}>(patcher, "{k:m[k] for k in ['HOST','VIEWPORT','VIEWPORT_ANCHOR','MODULE','EDITS','LEGACY_EDITS']}");
const temp = temporaryDirectory("pi-compact-layout-");
const sdk = process.env.PI_SDK_ROOT;
const { unitTest: test, nativeTest: realTest } = nativeSuite(import.meta.path, !!sdk);
const run = (root: string) => Bun.spawnSync(["python3", "-B", patcher], {
  env: { ...process.env, PI_SDK_ROOT: root, HOME: root },
});
const contents = (root: string) => [HOST, MODULE, VIEWPORT].map(file =>
  existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : null);

function fixture(name: string) {
  const root = join(temp, name);
  mkdirSync(dirname(join(root, MODULE)), { recursive: true });
  writeFileSync(join(root, "package.json"), '{"version":"0.87.1","type":"module"}');
  writeFileSync(join(root, HOST), EDITS.flatMap(([old, , count]) => Array(count).fill(old)).join("\n"));
  writeFileSync(join(root, VIEWPORT), VIEWPORT_ANCHOR);
  return root;
}

test("compact layout backs up exact sources and reapplies without writes", () => {
  const root = fixture("valid");
  const before = contents(root);
  checkProcess(run(root));
  const after = contents(root);
  expect(after[2]).toBe(before[2]); // Upstream already allows the footer to collapse.
  const backups = join(root, ".config/theme-backups");
  const names = readdirSync(backups);
  expect(names).toHaveLength(1);
  expect(readFileSync(join(backups, names[0], HOST), "utf8")).toBe(before[0]!);
  expect(readFileSync(join(backups, names[0], VIEWPORT), "utf8")).toBe(before[2]!);
  expect(JSON.parse(readFileSync(join(backups, names[0], "added-files.json"), "utf8"))).toEqual([MODULE]);
  checkProcess(run(root));
  expect(contents(root)).toEqual(after);
  expect(readdirSync(backups)).toEqual(names);
});

test("compact layout refuses partial, duplicate and modified installations before writes", () => {
  for (const state of ["version", "duplicate", "partial-import", "partial-budget", "modified", "missing", "unexpected", "changed-viewport", "duplicate-viewport", "old-viewport"]) {
    const root = fixture(state);
    if (state === "version") writeFileSync(join(root, "package.json"), '{"version":"0.85.0"}');
    else if (state === "duplicate") writeFileSync(join(root, HOST), contents(root)[0] + EDITS[0][0]);
    else if (state.endsWith("viewport")) {
      writeFileSync(join(root, VIEWPORT), state === "changed-viewport" ? "changed source"
        : state === "duplicate-viewport" ? VIEWPORT_ANCHOR + VIEWPORT_ANCHOR
        : VIEWPORT_ANCHOR.replace("minSize: 0", "minSize: 1"));
    } else if (state.startsWith("partial")) {
      const [old, next] = EDITS[state === "partial-import" ? 0 : 1];
      writeFileSync(join(root, HOST), contents(root)[0]!.replace(old, next));
    } else if (state === "unexpected") writeFileSync(join(root, MODULE), "unrelated helper");
    else {
      checkProcess(run(root));
      if (state === "missing") rmSync(join(root, MODULE));
      else writeFileSync(join(root, MODULE), "modified helper");
    }
    const before = contents(root);
    expect(run(root).exitCode).not.toBe(0);
    expect(contents(root)).toEqual(before);
  }
});

test("the initial-renderer hook migrates exactly and mixed hooks refuse", () => {
  const root = fixture("initial-renderer");
  let previous = contents(root)[0]! + "\n" + LEGACY_EDITS[1][0];
  for (const [old, patched] of LEGACY_EDITS) previous = previous.replaceAll(old, patched);
  writeFileSync(join(root, HOST), previous);
  writeFileSync(join(root, MODULE), readFileSync(new URL("../patches/payloads/host/legacy/compact-layout-v1.js.inc", import.meta.url), "utf8"));
  checkProcess(run(root));
  const after = contents(root);
  expect(after[0]).toContain(EDITS[1][1]);
  expect(after[0]).not.toContain(LEGACY_EDITS[1][1]);
  const backups = join(root, ".config/theme-backups");
  const names = readdirSync(backups);
  expect(names).toHaveLength(1);
  expect(readFileSync(join(backups, names[0], HOST), "utf8")).toBe(previous);
  expect(JSON.parse(readFileSync(join(backups, names[0], "added-files.json"), "utf8"))).toEqual([]);
  checkProcess(run(root));
  expect(contents(root)).toEqual(after);
  expect(readdirSync(backups)).toEqual(names);
  writeFileSync(join(root, HOST), after[0]! + "\n" + LEGACY_EDITS[1][1]);
  const mixed = contents(root);
  expect(run(root).exitCode).not.toBe(0);
  expect(contents(root)).toEqual(mixed);
});

realTest("native widget stack shares live short-window budgets without wrapping custom components", async () => {
  const root = join(temp, "native");
  copySdk(sdk!, root);
  checkProcess(run(root));
  const { InteractiveMode } = await import(pathToFileURL(join(root, HOST)).href);
  const { installActivityBudget } = await import(pathToFileURL(join(root, MODULE)).href);
  const { Container } = await import(pathToFileURL(join(root, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);
  const app = Object.create(InteractiveMode.prototype);
  app.runtimeHost = { session: { isCompacting: false } };
  app.ui = { terminal: { rows: 40 }, requestRender() {} };
  app.extensionWidgetsAbove = new Map();
  app.extensionWidgetsBelow = new Map();
  app.widgetContainerAbove = new Container();
  app.widgetContainerBelow = new Container();
  installActivityBudget(app.ui, app.extensionWidgetsAbove, app.extensionWidgetsBelow);
  let disposed = 0;
  for (const key of ["rpiv-todos", "agents"]) {
    app.setExtensionWidget(key, (tui: any) => ({
      render: () => Array(Math.min(6, tui.configsActivityRows())).fill(key),
      invalidate() {},
      dispose() { disposed++; },
    }));
  }
  for (const rows of [40, 12, 16, 20, 24, 12, 40]) {
    app.ui.terminal.rows = rows;
    const lines = app.widgetContainerAbove.render(40);
    expect(lines.length).toBe(rows >= 24 ? 13 : rows === 12 ? 2 : rows === 16 ? 4 : 6);
    for (const component of app.extensionWidgetsAbove.values()) {
      expect(app.widgetContainerAbove.children).toContain(component);
    }
  }
  app.ui.terminal.rows = 12;
  app.setExtensionWidget("agents", undefined);
  expect(app.widgetContainerAbove.render(40)).toEqual(Array(2).fill("rpiv-todos"));
  expect(disposed).toBe(1);
  const custom = { render: () => ["untouched"], invalidate() {} };
  app.setExtensionWidget("unrelated", () => custom);
  expect(app.ui.configsActivityRows()).toBe(2);
  expect(app.extensionWidgetsAbove.get("unrelated")).toBe(custom);
  app.clearExtensionWidgets();
  expect(disposed).toBe(2);
  expect(app.widgetContainerAbove.render(40)).toEqual([]);
  app.ui.terminal.rows = 40;
  expect(app.widgetContainerAbove.render(40)).toEqual([""]);
});

realTest("activity budgets follow regular/fullscreen renderer replacement", async () => {
  const root = join(temp, "mode-switch");
  copySdk(sdk!, root);
  checkProcess(run(root));
  const { InteractiveMode, createInteractiveTui, createInteractiveTuiReference } = await import(pathToFileURL(join(root, HOST)).href);
  const { installActivityBudget } = await import(pathToFileURL(join(root, MODULE)).href);
  const { TuiBase } = await import(pathToFileURL(join(root, "node_modules/@earendil-works/pi-tui/dist/tui.js")).href);
  const { VStack } = await import(pathToFileURL(join(root, "node_modules/@earendil-works/pi-tui/dist/components/v-stack.js")).href);
  TuiBase.prototype.requestRender = () => {};
  const terminal = { columns: 40, rows: 12, write() {}, hideCursor() {}, showCursor() {}, stop() {} };
  const app = Object.create(InteractiveMode.prototype);
  app.options = {};
  app.runtimeHost = { session: { settingsManager: { getFullscreenCopyOnSelect: () => false } } };
  app.extensionWidgetsAbove = new Map([["rpiv-todos", {}], ["agents", {}]]);
  app.extensionWidgetsBelow = new Map();
  app.renderer = createInteractiveTui({ tuiMode: "regular", terminal });
  app.ui = createInteractiveTuiReference(() => app.renderer);
  app.fullscreenLayoutRoot = new VStack([]);
  installActivityBudget(app.ui, app.extensionWidgetsAbove, app.extensionWidgetsBelow);
  const budget = app.ui.configsActivityRows;
  for (const mode of ["regular", "fullscreen", "regular"]) {
    expect(app.switchTuiMode(mode, false, false)).toBe(true);
    expect(budget()).toBe(1);
    terminal.rows = 40;
    expect(budget()).toBe(Infinity);
    terminal.rows = 12;
  }
});
