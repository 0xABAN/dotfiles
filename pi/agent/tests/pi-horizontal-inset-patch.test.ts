import { expect } from "bun:test";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { applySdkPatches, copySdk, describePatch, temporaryDirectory } from "./support/patch-fixtures";
import { nativeSuite } from "./support/native-suite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const patcher = fileURLToPath(new URL("../patches/pi-horizontal-inset.py", import.meta.url));
const { edits, legacyInset } = describePatch<{
  edits: Record<string, [string, string][]>; legacyInset: string;
}>(patcher, "{'edits':m['EDITS'],'legacyInset':m['LEGACY_INSET']}");
const temp = temporaryDirectory("pi-horizontal-inset-");
const sdk = process.env.PI_SDK_ROOT;
const { unitTest: test, nativeTest: realTest } = nativeSuite(import.meta.path, !!sdk);

function sandbox(name: string) {
  const root = join(temp, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.87.1" }));
  for (const [file, replacements] of Object.entries(edits)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), replacements.map(([old]) => old).join("\n") + "\n// unrelated change\n");
  }
  return {
    root,
    contents: () => Object.fromEntries(Object.keys(edits).map(file => [file, readFileSync(join(root, file), "utf8")])),
    run: () => Bun.spawnSync(["python3", "-B", patcher], { env: { ...process.env, PI_SDK_ROOT: root, HOME: root } }),
  };
}

test("patch validates all files, backs up exact sources, and is idempotent", () => {
  const app = sandbox("valid");
  const before = app.contents();
  expect(app.run().exitCode).toBe(0);
  const after = app.contents();
  const backupRoot = join(app.root, ".config/theme-backups");
  const backups = readdirSync(backupRoot);
  expect(backups).toHaveLength(1);
  for (const file of Object.keys(edits)) {
    expect(readFileSync(join(backupRoot, backups[0], file), "utf8")).toBe(before[file]);
    expect(after[file]).toContain("// unrelated change");
  }
  expect(app.run().exitCode).toBe(0);
  expect(app.contents()).toEqual(after);
  expect(readdirSync(backupRoot)).toEqual(backups);
});

test("the installed older inset upgrades without duplicating methods", () => {
  const app = sandbox("legacy");
  expect(app.run().exitCode).toBe(0);
  const current = app.contents();
  const file = "node_modules/@earendil-works/pi-tui/dist/tui.js";
  writeFileSync(join(app.root, file), current[file].replace(edits[file][0][1], legacyInset));
  expect(app.run().exitCode).toBe(0);
  expect(app.contents()).toEqual(current);
});

test("partial, incompatible, and changed hosts fail before writing", () => {
  const lastFile = Object.keys(edits).at(-1)!;
  for (const state of ["partial", "changed", "version"]) {
    const app = sandbox(state);
    if (state === "version") writeFileSync(join(app.root, "package.json"), '{"version":"0.85.0"}');
    else writeFileSync(join(app.root, lastFile), state === "partial" ? edits[lastFile].map(([, patched]) => patched).join("\n") : "unknown source");
    const before = app.contents();
    expect(app.run().exitCode).not.toBe(0);
    expect(app.contents()).toEqual(before);
  }
});

test("absent Pi installation is a harmless skip", () => {
  const result = Bun.spawnSync(["python3", "-B", patcher], { env: { ...process.env, PI_SDK_ROOT: join(temp, "absent") } });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("skipping");
});

test("prompt markers precede the inset so Ghostty does not advance an extra row", () => {
  const methods = edits["node_modules/@earendil-works/pi-tui/dist/tui.js"][0][1];
  const Frame = new Function(`return class { ${methods} }`)();
  const frame = new Frame();
  const starts = ["\x1b]133;A\x07", "\x1b]133;A\x1b\\", "\x1b]133;B\x07\x1b]133;C\x07"];
  const image = "\x1b_Ga=T;YWJj\x1b\\";
  for (const start of starts) {
    expect(frame.insetLines([start, start + "You", start + image], 100)).toEqual([
      start + "  ", start + "  You", start + "  " + image,
    ]);
  }
  expect(frame.insetLines(["", image, "plain"], 100)).toEqual(["", "  " + image, "  plain"]);
});

// Native checks import disposable sources with this checkout's inset applied.
let fixture: string | undefined;
function nativeRoot() {
  if (!fixture) {
    fixture = join(temp, "sdk");
    copySdk(sdk!, fixture);
    applySdkPatches(fixture, ["pi-horizontal-inset"]);
  }
  return fixture;
}
const load = (file: string) => import(pathToFileURL(join(nativeRoot(), "node_modules/@earendil-works/pi-tui/dist", file)).href);
const margin = (width: number) => width < 16 ? 0 : Math.max(1, Math.floor(width * 0.02));
const marker = "\x1b_pi:c\x07";

async function renderer(mode: "regular" | "fullscreen", width = 100, rows = 12) {
  const name = mode === "regular" ? "TuiMainScreen" : "TuiAltScreen";
  const module = await load(mode === "regular" ? "tui-main-screen.js" : "tui-alt-screen.js");
  const terminal = { columns: width, rows, writes: [] as string[], write(data: string) { this.writes.push(data); }, hideCursor() {}, showCursor() {}, start() {}, stop() {} };
  const tui = new module[name](terminal, true);
  // Synchronous fake-terminal frames, without scheduler/background timers.
  tui.requestRender = () => {};
  tui.requestImmediateRender = () => {};
  if (mode === "fullscreen") tui.altScreenActive = true;
  return { tui, terminal, lines: () => mode === "regular" ? tui.previousLines : tui.previousScreen };
}

function component(render: (width: number) => string[]) {
  return { render, invalidate() {} };
}

realTest("both real render roots share wrapping, footer boundaries, resize and Unicode cursor positions", async () => {
  const { stripTerminalSequences, visibleWidth } = await load("utils.js");
  for (const mode of ["regular", "fullscreen"] as const) {
    const app = await renderer(mode);
    const widths: number[] = [];
    app.tui.addChild(component(width => {
      widths.push(width);
      return ["\x1b[32m" + "x".repeat(width) + "\x1b[0m", "界🙂" + marker + "input", "L" + " ".repeat(Math.max(0, width - 2)) + "R"];
    }));
    for (const width of [100, 160, 80, 16, 15, 9]) {
      app.terminal.columns = width;
      app.tui.renderNow();
      const inset = margin(width);
      expect(widths.at(-1)).toBe(width - 2 * inset);
      const lines = app.lines();
      expect(stripTerminalSequences(lines[0])).toBe(" ".repeat(inset) + "x".repeat(width - 2 * inset));
      expect(stripTerminalSequences(lines[2]).indexOf("L")).toBe(inset);
      expect(stripTerminalSequences(lines[2]).indexOf("R")).toBe(width - inset - 1);
      expect(lines.every((line: string) => visibleWidth(line) <= width)).toBe(true);
      expect(lines.join("")).not.toContain(marker);
      const cursor = mode === "regular" ? `\x1b[${inset + 5}G` : `\x1b[2;${inset + 5}H`;
      expect(app.terminal.writes.join("")).toContain(cursor);
      expect(app.terminal.columns).toBe(width);
    }
  }
});

realTest("overlays clamp absolute, percent and anchored layouts inside the same boundary", async () => {
  const { stripTerminalSequences } = await load("utils.js");
  for (const mode of ["regular", "fullscreen"] as const) {
    const app = await renderer(mode);
    app.tui.addChild(component(width => ["b".repeat(width)]));
    for (const options of [
      { width: "100%", anchor: "top-left" },
      { width: 1000, col: -30 },
      { width: "50%", anchor: "top-right", offsetX: 100 },
      { width: 30, col: "100%", margin: 1 },
    ]) {
      let renderedWidth = 0;
      let visibleWidth = 0;
      const handle = app.tui.showOverlay(component(width => {
        renderedWidth = width;
        return [marker + "o".repeat(width)];
      }), { ...options, row: 0, visible: (width: number) => { visibleWidth = width; return true; } });
      app.tui.renderNow();
      const row = app.lines().map(stripTerminalSequences).find((line: string) => line.includes("o"));
      expect(row.indexOf("o")).toBeGreaterThanOrEqual(2);
      expect(row.lastIndexOf("o")).toBeLessThan(98);
      expect(renderedWidth).toBeLessThanOrEqual(96);
      expect(visibleWidth).toBe(96);
      handle.hide();
    }
  }
});

realTest("fullscreen layout, mouse selection, scrollbar, search and flashes use physical coordinates", async () => {
  const { ScrollView } = await load("components/scroll-view.js");
  const { VStack } = await load("components/v-stack.js");
  const { getScrollViewBox, getScrollViewsAt, getScrollbarGeometry } = await load("layout.js");
  const { stripTerminalSequences } = await load("utils.js");
  const app = await renderer("fullscreen", 100, 10);
  const scroll = new ScrollView(component(width => Array.from({ length: 30 }, (_, i) => (`row${i} hello `).padEnd(width, "."))), { primary: true, scrollbar: "always" });
  const footer = component(width => ["F" + " ".repeat(width - 2) + "R"]);
  app.tui.setLayoutRoot(new VStack([{ component: scroll, basis: 0, grow: 1 }, { component: footer, basis: 1 }]));
  app.tui.renderNow();
  const box = getScrollViewBox(app.tui.currentLayout, scroll);
  expect(box.rect.x).toBe(2);
  expect(box.clip.x).toBe(2);
  expect(box.rect.width).toBe(96);
  expect(getScrollViewsAt(app.tui.currentLayout, 1, 0)).toEqual([]);
  expect(getScrollViewsAt(app.tui.currentLayout, 2, 0)).toEqual([scroll]);
  expect(getScrollbarGeometry(box).column).toBe(97);
  expect(app.tui.getScrollbarTargetAt(97, 0)?.scrollView).toBe(scroll);
  expect(app.tui.getScrollSelectionPoint(scroll, 7, 0).col).toBe(5);
  expect(app.tui.getSelectionSourceLine({ row: 0, col: 0, scrollView: scroll })).toStartWith("row0");
  app.tui.handleTerminalInput("\x1b[<0;3;1M");
  expect(app.tui.selectionAnchor.col).toBe(0);
  expect(app.tui.selectionAnchor.scrollView).toBe(scroll);
  app.tui.handleTerminalInput("\x1b[O"); // Cancel selection without touching clipboard.
  app.tui.toggleSearch();
  app.tui.updateSearchQuery("hello");
  app.tui.renderNow();
  expect(app.tui.activeSearch.matches.length).toBe(30);
  expect(app.tui.currentLayout.root.rect.x).toBe(2);
  app.tui.closeSearch();
  app.tui.flashes.render = (width: number) => { expect(width).toBe(96); return ["flash"]; };
  app.tui.renderNow();
  expect(stripTerminalSequences(app.lines()[0]).indexOf("flash")).toBe(93);
  expect(stripTerminalSequences(app.lines()[9]).indexOf("R")).toBe(97);
});

realTest("fresh Pi composition root keeps the inset across regular/fullscreen switches", () => {
  const result = Bun.spawnSync(["node", "--input-type=module", "--eval", `
    import assert from 'node:assert/strict';
    const root = process.env.PI_SDK_ROOT;
    const { InteractiveMode, createInteractiveTui, createInteractiveTuiReference } = await import(root + '/dist/modes/interactive/interactive-mode.js');
    const { TuiBase } = await import(root + '/node_modules/@earendil-works/pi-tui/dist/tui.js');
    const { VStack } = await import(root + '/node_modules/@earendil-works/pi-tui/dist/components/v-stack.js');
    TuiBase.prototype.requestRender = () => {};
    const terminal = { columns: 100, rows: 10, write() {}, hideCursor() {}, showCursor() {}, stop() {} };
    let receivedWidth;
    const child = { render(width) { receivedWidth = width; return ['x'.repeat(width)]; }, invalidate() {} };
    const app = Object.create(InteractiveMode.prototype);
    app.options = {};
    app.runtimeHost = { session: { settingsManager: { getFullscreenCopyOnSelect: () => false } } };
    app.renderer = createInteractiveTui({ tuiMode: 'regular', terminal });
    app.ui = createInteractiveTuiReference(() => app.renderer);
    app.fullscreenLayoutRoot = new VStack([{ component: child }]);
    app.renderer.addChild(child);
    const render = app.ui.renderNow; // A captured proxy method must follow renderer replacement.
    for (const mode of ['regular', 'fullscreen', 'regular']) {
      assert.equal(app.switchTuiMode(mode, false, false), true);
      if (mode === 'fullscreen') app.renderer.altScreenActive = true;
      render();
      assert.equal(receivedWidth, 96);
      assert.equal(app.ui.terminal, terminal);
      const line = (app.renderer.previousLines ?? app.renderer.previousScreen)[0];
      assert.ok(line.startsWith('  ' + 'x'.repeat(96)));
    }
    console.log('fresh Pi mode-switch smoke passed');
  `], { env: { ...process.env, PI_SDK_ROOT: nativeRoot() }, timeout: 30_000 });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  expect(result.stdout.toString()).toContain("fresh Pi mode-switch smoke passed");
});

realTest("fullscreen exit transcript uses the same inset without altering image bytes", async () => {
  const app = await renderer("fullscreen");
  const payload = "\x1b]1337;File=inline=1:YWJj\x07";
  let receivedWidth = 0;
  app.tui.addChild(component(width => { receivedWidth = width; return ["text", payload]; }));
  app.tui.afterTerminalStop({ preserveScreen: false });
  expect(receivedWidth).toBe(96);
  expect(app.terminal.writes.join("")).toContain("  text");
  expect(app.terminal.writes.join("")).toContain("  " + payload);
});

realTest("image reservation, payload, Kitty crop and cached placement survive inset", async () => {
  const { registerKittyImageMetadata, getKittyImageMetadata } = await load("terminal-image.js");
  const { ScrollView } = await load("components/scroll-view.js");
  const payload = "\x1b_Ga=T,f=100,i=991,c=4,r=3,C=1;YWJj\x1b\\";
  registerKittyImageMetadata({ imageId: 991, columns: 4, rows: 3, widthPx: 40, heightPx: 60 });
  const regular = await renderer("regular");
  regular.tui.addChild(component(() => [payload, "", "", "end"]));
  regular.tui.renderNow();
  expect(regular.lines()[0]).toBe("  " + payload);
  expect(regular.tui.getKittyImageReservedRows(regular.lines(), 0)).toBe(3);
  expect(regular.terminal.writes.join("")).toContain("\r\n\r\n\x1b[2A  " + payload);

  const app = await renderer("fullscreen", 100, 3);
  app.tui.imageProtocol = "kitty";
  const scroll = new ScrollView(component(() => [payload, "", "", "end"]), { primary: true });
  app.tui.setLayoutRoot(scroll);
  app.tui.renderNow();
  expect(app.lines()[0]).toBe("  " + payload);
  scroll.scrollTo(1);
  app.tui.renderNow();
  expect(app.lines()[0]).toStartWith("  \x1b_G");
  expect(app.lines()[0]).toContain("y=20,h=40,r=2;");
  expect(app.lines()[0]).toContain("YWJj\x1b\\");
  expect(getKittyImageMetadata(app.lines()[0]).imageId).toBe(991);
  expect(app.terminal.writes.at(-1)).toContain("  \x1b_Ga=p,");
});
