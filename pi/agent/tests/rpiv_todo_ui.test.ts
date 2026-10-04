import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { applySdkPatches, checkProcess as assertRun, copyPackageSources, copySdk, describePatch, temporaryDirectory } from "./support/patch_fixtures";
import { nativeSuite } from "./support/native_suite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const patcher = process.env.RPIV_TODO_UI_TEST_PATCHER ?? fileURLToPath(new URL("../patches/rpiv_todo_ui.py", import.meta.url));
const legacy = join(dirname(patcher), "rpiv_todo_gray.py");
const temp = temporaryDirectory("rpiv-todo-ui-");
const installed = process.env.RPIV_TODO_TEST_ROOT ?? join(homedir(), ".pi/agent/npm/node_modules/@juicesharp/rpiv-todo");
const sdkSource = process.env.PI_SDK_ROOT;
const sdk = join(temp, "sdk");
const { unitTest: test, nativeTest: realTest } = nativeSuite(import.meta.path, !!sdkSource && existsSync(installed), { FORCE_COLOR: "1" });
const edits = describePatch<Record<string, [string, string][]>>(patcher, "m['EDITS']");
const compactEdits = describePatch<Record<string, [string, string][]>>(patcher, "m['COMPACT_EDITS']");
const toolRowEdits = describePatch<Record<string, [string, string][]>>(patcher, "m['TOOL_ROW_EDITS']");
const files = Object.keys(edits);
const run = (root: string, home = root) => Bun.spawnSync(["python3", "-B", patcher], {
  env: { ...process.env, HOME: home, RPIV_TODO_ROOT: root },
});
const contents = (root: string) => Object.fromEntries(files.map(file => [file, readFileSync(join(root, file), "utf8")]));
function sandbox(name: string, previous = false) {
  const root = join(temp, name);
  mkdirSync(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@juicesharp/rpiv-todo", version: "2.9.0", type: "module" }));
  for (const [file, changes] of Object.entries(edits)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    const replacements = changes.flatMap(([old, replacement]) => file === "todo-overlay.ts" && old === 'theme.fg("dim", "└─")' ? [replacement, replacement] : [replacement]);
    let source = replacements.join("\n");
    for (const [old] of compactEdits[file] ?? []) {
      if (source.includes(old)) continue;
      // This larger anchor owns one of the two existing final-branch sites.
      if (old.includes('theme.fg("dim", "╰─")')) source = source.replace('theme.fg("dim", "╰─")', old);
      else source += "\n" + old;
    }
    if (!previous) for (const [old, replacement] of changes) source = source.replaceAll(replacement, old);
    writeFileSync(join(root, file), source + "\n// unrelated installed edit\n");
  }
  return root;
}

test("Todo UI validates every file, preserves unrelated edits, backs up exact originals and repeats", () => {
  const root = sandbox("original");
  const before = contents(root);
  assertRun(run(root));
  const after = contents(root);
  const backupRoot = join(root, ".config/theme-backups");
  const backups = readdirSync(backupRoot);
  expect(backups).toHaveLength(1);
  for (const file of files) {
    expect(readFileSync(join(backupRoot, backups[0], file), "utf8")).toBe(before[file]);
    expect(after[file]).toContain("// unrelated installed edit");
  }
  assertRun(run(root));
  expect(contents(root)).toEqual(after);
  expect(readdirSync(backupRoot)).toEqual(backups);
});

test("Todo UI refuses wrong versions, missing/duplicate/modified anchors and mixed installs without writes", () => {
  for (const state of ["version", "missing", "duplicate", "mixed", "modified", "residual", "altered-clear", "clear-and-mixed"]) {
    const root = sandbox(state);
    const file = "todo.ts";
    const [old, replacement] = edits[file][0];
    if (state === "version") writeFileSync(join(root, "package.json"), '{"version":"3.0.0"}');
    else if (state === "mixed") writeFileSync(join(root, file), readFileSync(join(root, file), "utf8").replace(old, replacement));
    else if (state === "missing") writeFileSync(join(root, file), "unrecognized source");
    else if (state === "duplicate") writeFileSync(join(root, file), readFileSync(join(root, file), "utf8") + old);
    else {
      assertRun(run(root));
      const format = join(root, "view/format.ts");
      if (state === "modified") writeFileSync(format, readFileSync(format, "utf8").replace("width < 80 ? 1 : 3", "width < 80 ? 2 : 3"));
      else if (state === "altered-clear" || state === "clear-and-mixed") {
        const [originalClear, styledClear] = edits["index.ts"][1];
        const index = join(root, "index.ts");
        const reinjected = readFileSync(index, "utf8").replace(styledClear, originalClear);
        writeFileSync(index, state === "altered-clear" ? reinjected.replace("if (before > 0)", "if (before > 1)") : reinjected);
        if (state === "clear-and-mixed") writeFileSync(join(root, file), readFileSync(join(root, file), "utf8").replace(replacement, old));
      } else writeFileSync(join(root, file), readFileSync(join(root, file), "utf8") + old);
    }
    const before = contents(root);
    const backupRoot = join(root, ".config/theme-backups");
    const backups = existsSync(backupRoot) ? readdirSync(backupRoot) : [];
    expect(run(root).exitCode).not.toBe(0);
    expect(contents(root)).toEqual(before);
    expect(existsSync(backupRoot) ? readdirSync(backupRoot) : []).toEqual(backups);
  }
  expect(run(join(temp, "absent")).exitCode).toBe(0);
});

test("Todo tool renderer migration is complete and rejects mixed sources", () => {
  const root = sandbox("tool-renderer");
  assertRun(run(root));
  const current = contents(root);
  for (const [old, replacement] of toolRowEdits["view/format.ts"]) {
    expect(current["view/format.ts"]).toContain(replacement);
    expect(current["view/format.ts"]).not.toContain(old);
  }
  assertRun(run(root));
  expect(contents(root)).toEqual(current);

  const broken = sandbox("tool-renderer-modified");
  assertRun(run(broken));
  const format = join(broken, "view/format.ts");
  writeFileSync(format, readFileSync(format, "utf8").replace("render: () => []", "render: () => [\"changed\"]"));
  const before = contents(broken);
  expect(run(broken).exitCode).not.toBe(0);
  expect(contents(broken)).toEqual(before);
});

test("compact Todo UI migrates only complete previous sources and exact clear reinjection", () => {
  const root = sandbox("previous", true);
  const before = contents(root);
  assertRun(run(root));
  const current = contents(root);
  const backups = join(root, ".config/theme-backups");
  const [backup] = readdirSync(backups);
  for (const file of files) expect(readFileSync(join(backups, backup, file), "utf8")).toBe(before[file]);
  assertRun(run(root));
  expect(contents(root)).toEqual(current);
  expect(readdirSync(backups)).toEqual([backup]);

  for (const compact of [false, true]) {
    const replayRoot = sandbox(`replay-${compact}`, true);
    if (compact) assertRun(run(replayRoot));
    const index = join(replayRoot, "index.ts");
    const [original, styled] = edits["index.ts"][1];
    const source = readFileSync(index, "utf8").replace(styled, original);
    writeFileSync(index, source);
    assertRun(run(replayRoot));
    expect(readFileSync(index, "utf8")).toBe(source.replace(original, styled));
  }

  for (const state of ["partial", "modified", "duplicate", "mixed-legacy"]) {
    const broken = sandbox(`compact-${state}`, true);
    const overlay = join(broken, "todo-overlay.ts");
    const [old, replacement] = compactEdits["todo-overlay.ts"][0];
    if (state === "partial") writeFileSync(overlay, readFileSync(overlay, "utf8").replace(old, replacement));
    else {
      assertRun(run(broken));
      let source = readFileSync(overlay, "utf8");
      if (state === "modified") source = source.replace("Math.max(2, compactRows)", "Math.max(3, compactRows)");
      if (state === "duplicate") source += replacement;
      if (state === "mixed-legacy") source = source.replace(edits["todo-overlay.ts"][0][1], edits["todo-overlay.ts"][0][0]);
      writeFileSync(overlay, source);
    }
    const unchanged = contents(broken);
    const backupRoot = join(broken, ".config/theme-backups");
    const beforeBackups = existsSync(backupRoot) ? readdirSync(backupRoot) : [];
    expect(run(broken).exitCode).not.toBe(0);
    expect(contents(broken)).toEqual(unchanged);
    expect(existsSync(backupRoot) ? readdirSync(backupRoot) : []).toEqual(beforeBackups);
  }
});

let loaded: Promise<any> | undefined;
function real() {
  return loaded ??= (async () => {
    copySdk(sdkSource!, sdk);
    applySdkPatches(sdk, ["pi_horizontal_inset", "pi_transcript", "pi_activity_notices", "pi_compact_layout"]);
    const home = join(temp, "real");
    const root = join(home, ".pi/agent/npm/node_modules/@juicesharp/rpiv-todo");
    copyPackageSources(installed, root);
    // Normalize our complete patch in the COPY so the suite remains replayable.
    for (const [file, changes] of Object.entries(edits)) {
      let source = readFileSync(join(root, file), "utf8");
      for (const [old, replacement] of compactEdits[file] ?? []) source = source.replaceAll(replacement, old);
      for (const [old, replacement] of toolRowEdits[file] ?? []) source = source.replaceAll(replacement, old);
      for (const [old, replacement] of changes) source = source.replaceAll(replacement, old);
      writeFileSync(join(root, file), source);
    }
    // Install the supplied backend into this COPY first. A clean checkout can
    // intentionally carry a different clear implementation than the live package.
    assertRun(Bun.spawnSync(["python3", "-B", legacy], { env: { ...process.env, HOME: home } }));
    const before = contents(root);
    assertRun(run(root, home));
    const after = contents(root);
    let unchangedIndex = after["index.ts"];
    for (const [original, styled] of edits["index.ts"]) unchangedIndex = unchangedIndex.replace(styled, original);
    expect(unchangedIndex).toBe(before["index.ts"]);
    // The old script reinstalls the exact clear block, while leaving its new
    // formatter import and all other styling intact. Only that replay is allowed.
    for (let i = 0; i < 2; i++) {
      const replay = Bun.spawnSync(["python3", "-B", legacy], { env: { ...process.env, HOME: home } });
      assertRun(replay);
      const reinjected = contents(root);
      for (const file of files.filter(file => file !== "index.ts")) expect(reinjected[file]).toBe(after[file]);
      const [originalClear, styledClear] = edits["index.ts"][1];
      expect(reinjected["index.ts"]).toContain(originalClear);
      expect(reinjected["index.ts"]).not.toContain(styledClear);
      assertRun(run(root, home));
      const reapplied = contents(root);
      // Preserve the legacy script's own blank lines and all backend bytes.
      expect(reapplied["index.ts"]).toBe(reinjected["index.ts"].replace(originalClear, styledClear));
      assertRun(run(root, home));
      expect(contents(root)).toEqual(reapplied);
    }
    let previousOverlay = after["todo-overlay.ts"];
    for (const [old, replacement] of compactEdits["todo-overlay.ts"]) previousOverlay = previousOverlay.replace(replacement, old);
    writeFileSync(join(root, "todo-overlay-before.ts"), previousOverlay);
    const modules = join(root, "node_modules");
    mkdirSync(join(modules, "@earendil-works"), { recursive: true });
    for (const name of ["pi-tui", "pi-ai"]) {
      symlinkSync(join(sdk!, "node_modules/@earendil-works", name), join(modules, "@earendil-works", name));
    }
    symlinkSync(sdk!, join(modules, "@earendil-works/pi-coding-agent"));
    mkdirSync(join(modules, "@juicesharp"));
    symlinkSync(join(dirname(installed), "rpiv-config"), join(modules, "@juicesharp/rpiv-config"));
    symlinkSync(join(dirname(dirname(installed)), "typebox"), join(modules, "typebox"));
    process.env.XDG_CONFIG_HOME = join(home, ".config");
    const load = (file: string) => import(pathToFileURL(join(root, file)).href);
    const tui = await import(pathToFileURL(join(sdk!, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);
    const colors = await import(pathToFileURL(join(sdk!, "dist/modes/interactive/theme/theme.js")).href);
    const theme = colors.loadThemeFromPath(fileURLToPath(new URL("../themes/osaka-jade.json", import.meta.url)), "truecolor");
    return { ...await load("view/format.ts"), ...await load("todo-overlay.ts"), ...await load("todo.ts"),
      PreviousTodoOverlay: (await load("todo-overlay-before.ts")).TodoOverlay,
      ...await import(pathToFileURL(join(sdk, "dist/modes/interactive/components/compact-layout.js")).href),
      registerExtension: (await load("index.ts")).default,
      store: await load("state/store.ts"), tui, theme, colors, root, home, before };
  })();
}
const task = (id: number, status: string, subject = `Task ${id}`) => ({ id, status, subject, activeForm: "checking 漢字 é", description: "detail", blockedBy: [] });
function assertWidths(m: any, render: (width: number) => string[]) {
  for (const width of [4, 8, 20, 80]) {
    const lines = render(width);
    for (const line of lines) {
      expect(m.tui.visibleWidth(line)).toBeLessThanOrEqual(width);
      expect(line).not.toMatch(/\x1b\[(?:4[0-8]|10[0-7])(?:;|m)/);
    }
  }
}
const text = (m: any, component: any, width = 80) => component.render(width).map(m.tui.stripTerminalSequences).join("\n");

realTest("actual status formatters use distinct geometry, muted completion, live colors and safe subjects", async () => {
  const m = await real();
  const seen = new Set<string>();
  for (const status of ["pending", "in_progress", "completed", "deleted"]) {
    const glyph = m.overlayStatusGlyph(status, m.theme);
    seen.add(m.tui.stripTerminalSequences(glyph));
    expect(glyph).toBe(m.theme.fg(status === "in_progress" ? "accent" : "muted", m.STATUS_GLYPH[status]));
    const row = m.formatOverlayTaskLine(task(9, status, "safe\x1b[41m\n\u202eevil"), m.theme, true);
    const plain = m.tui.stripTerminalSequences(row);
    expect(plain).toContain("#9 safe evil");
    expect(row).not.toContain("\x1b[41m");
    expect(row).not.toContain("\u202e");
    expect(plain.includes("(checking 漢字 é)")).toBe(status === "in_progress");
    expect(row.includes("\x1b[9m")).toBe(status === "completed" || status === "deleted");
    expect(m.formatOverlayTaskLine(task(9, status), m.theme, false)).not.toContain("#9");
  }
  expect(seen.size).toBe(4);
  const state = { tasks: [task(9, "in_progress", "漢字 é long label")], nextId: 10 };
  for (const args of [{ action: "create", subject: "漢字 é very long subject" }, { action: "update", id: 9 },
    { action: "get", id: 900 }, { action: "delete", id: 9 }, { action: "list", status: "pending" }, { action: "clear" }, {}]) {
    const call = m.renderTodoCall(args, m.theme, state);
    expect(call.render(40)).toEqual([]);
    expect(call.render(80)).toEqual([]);
  }
});

realTest("Todo uses the shared Tasks action row without a custom body", async () => {
  const m = await real();
  let definition: any;
  m.registerTodoTool({ registerTool(value: any) { definition = value; } });
  expect(definition.renderShell).toBe("self");
  const call = m.renderTodoCall({ action: "create", subject: "漢字 full label" }, m.theme, { tasks: [] });
  const result = m.renderTodoResult({ details: { action: "update", params: { id: 2 }, tasks: [task(2, "in_progress")] } }, m.theme);
  expect(call.render(80)).toEqual([]);
  expect(result.render(80)).toEqual([]);
  expect(call.render(40)).toEqual([]);
  expect(result.render(40)).toEqual([]);

  m.colors.setThemeInstance(m.theme);
  const { ToolExecutionComponent } = await import(pathToFileURL(join(sdk!, "dist/modes/interactive/components/tool-execution.js")).href);
  const row = new ToolExecutionComponent("todo", "todo-ui-check", { action: "create", subject: "漢字 full label" },
    {}, definition, { requestRender() {} }, temp);
  row.updateResult({ content: [{ type: "text", text: "Rejected transition" }], isError: true });
  for (const width of [40, 80]) expect(row.render(width)).toEqual([]);
  const { actionLines, TranscriptContainer } = await import(pathToFileURL(join(sdk!, "dist/modes/interactive/components/transcript.js")).href);
  const action = text(m, { render: () => actionLines(row, 80), invalidate() {} });
  expect(action).toMatch(/Tasks\s+todo\(/);
  expect(action).toContain("漢字 full label");
  const transcript = new TranscriptContainer(() => 1, () => Infinity);
  transcript.addChild(row);
  const transcriptOutput = text(m, transcript, 80);
  expect(transcriptOutput).toMatch(/Tasks\s+todo\(/);
  expect(transcriptOutput).not.toContain("▧ Todo");
  expect(transcriptOutput).toContain("漢字 full label");
});

realTest("TodoOverlay retains alignment, theme refresh, overflow, expansion, hiding, collapse and registration", async () => {
  const m = await real();
  m.store.__resetState();
  m.store.setActiveRenderSession("main");
  const tasks = [task(1, "completed"), task(2, "in_progress", "漢字 long task é"), task(3, "pending"), task(4, "deleted")];
  m.store.replaceState("main", { tasks, nextId: 5 });
  let widget: any;
  let registrations = 0;
  let expanded = false;
  let refreshes = 0;
  const ctx = { theme: m.theme, getToolsExpanded: () => expanded,
    setWidget(_key: string, factory: any) { registrations++; widget = factory?.({ requestRender() { refreshes++; } }, m.theme); } };
  const overlay = new m.TodoOverlay();
  overlay.setUICtx(ctx);
  overlay.update();
  const plain = () => text(m, widget);
  assertWidths(m, width => widget.render(width));
  expect(plain()).toContain("   ◈ Todos (1/3)");
  expect(plain()).toContain("   ╰─ ◇ Task 3");
  expect(plain()).not.toContain("Task 4");
  expect(widget.render(80)[0]).toContain(m.theme.fg("muted", "Todos (1/3)"));
  overlay.update();
  expect(registrations).toBe(1);
  expect(refreshes).toBe(1);
  ctx.theme = { ...m.theme, fg: (_: string, value: string) => value.toUpperCase(), strikethrough: (value: string) => value };
  widget.invalidate();
  expect(plain()).toContain("TODOS");
  ctx.theme = m.theme;
  overlay.hideCompletedTasksFromPreviousTurn();
  expect(plain()).not.toContain("Task 1");
  overlay.resetCompletedDisplayState();
  expect(plain()).toContain("Task 1");
  const configPath = join(m.home, ".config/rpiv-todo/config.json");
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, '{"maxWidgetLines":3,"collapseKey":"off"}');
  m.store.replaceState("main", { tasks: [...tasks, task(5, "pending"), task(6, "pending")], nextId: 7 });
  expect(plain()).toContain("more");
  expanded = true;
  expect(plain()).not.toContain("more");
  expect(plain()).toContain("Task 6");
  overlay.toggleCollapse();
  expect(plain()).toContain("╰─ collapsed");
  expect(plain()).not.toContain("Task 6");
  writeFileSync(configPath, '{"maxWidgetLines":3,"collapseKey":"ctrl+shift+t"}');
  expect(plain()).toContain("ctrl+shift+t to expand");
  overlay.toggleCollapse();
  m.store.replaceState("main", { tasks: [], nextId: 1 });
  overlay.update();
  expect(widget).toBeUndefined();
  overlay.dispose();
  expect(overlay.isRegistered()).toBe(false);
});

realTest("compact Todo previews share live host budgets and retain active work, counts and display state", async () => {
  const m = await real();
  m.store.__resetState();
  m.store.setActiveRenderSession("compact");
  const configPath = join(m.home, ".config/rpiv-todo/config.json");
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, '{"maxWidgetLines":12,"collapseKey":"off"}');
  const tasks = [task(1, "completed", "Done"), task(2, "pending", "Waiting"),
    task(3, "in_progress", "Active"), task(4, "pending", "Later"), task(5, "deleted", "Deleted")];
  const state = { tasks, nextId: 6 };
  m.store.replaceState("compact", state);
  const above = new Map<string, unknown>();
  const below = new Map<string, unknown>();
  const tui = { terminal: { rows: 30 }, requestRender() {} };
  m.installActivityBudget(tui, above, below);
  let expanded = false;
  let widget: any;
  const ctx = { theme: m.theme, getToolsExpanded: () => expanded,
    setWidget(key: string, factory: any) {
      if (factory) { above.set(key, factory); widget = factory(tui, m.theme); }
      else above.delete(key);
    } };
  const overlay = new m.TodoOverlay();
  overlay.setUICtx(ctx);
  overlay.update();
  const render = (width = 40) => widget.render(width).map(m.tui.stripTerminalSequences);
  const normal = widget.render(80);
  let previousWidget: any;
  const previous = new m.PreviousTodoOverlay();
  previous.setUICtx({ ...ctx, setWidget(_key: string, factory: any) { previousWidget = factory(tui, m.theme); } });
  previous.update();
  for (const width of [80, 120]) expect(widget.render(width)).toEqual(previousWidget.render(width));

  tui.terminal.rows = 14;
  above.set("agents", {});
  let lines = render();
  expect(lines).toHaveLength(2);
  expect(previousWidget.render(40).length).toBeGreaterThan(2);
  expect(lines[0]).toContain("Todos (1/4) · +3 more");
  expect(lines[1]).toContain("Active");
  expect(lines[1]).not.toContain("Waiting");
  expect(lines.every((line: string) => line.trim().length > 0)).toBe(true);
  expanded = true;
  expect(render()).toEqual(lines);
  expect(expanded).toBe(true);
  above.delete("agents");
  lines = render();
  expect(lines).toHaveLength(4);
  expect(lines[0]).toContain("+1 more");
  expect(lines[1]).toContain("Active");
  expect(lines[2]).toContain("Waiting");
  expect(lines[3]).toContain("Later");

  tui.terminal.rows = 12;
  above.set("agents", {});
  lines = render();
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("Todos · +3 more · ◈ Active");
  for (const width of [1, 2, 3, 4, 8, 20, 40, 79, 80]) {
    for (const line of widget.render(width)) expect(m.tui.visibleWidth(line)).toBeLessThanOrEqual(width);
  }
  expect(m.todoGutter(40)).toBe(1);
  expect(m.todoGutter(79)).toBe(1);
  expect(m.todoGutter(80)).toBe(3);
  const tool = m.renderTodoCall({ action: "create", subject: "漢字 é" }, m.theme, state);
  expect(tool.render(40)).toEqual([]);
  expect(tool.render(80)).toEqual([]);

  overlay.toggleCollapse();
  expect(render()).toHaveLength(1);
  expect(render()[0]).toContain("collapsed");
  tui.terminal.rows = 14;
  expect(render()).toHaveLength(2);
  expect(render()[1]).toContain("collapsed");
  tui.terminal.rows = 30;
  expect(render().join("\n")).toContain("collapsed");
  overlay.toggleCollapse();
  expanded = false;
  expect(widget.render(80)).toEqual(normal);
  expect(m.store.getState("compact")).toBe(state);

  // Short previews do not change the pre-existing completed-display policy:
  // a noncollapsed render tracks eligible completed tasks, not its chosen slice.
  for (const Controller of [m.TodoOverlay, m.PreviousTodoOverlay]) {
    let trackedWidget: any;
    const tracked = new Controller();
    tracked.setUICtx({ ...ctx, setWidget(_key: string, factory: any) { trackedWidget = factory(tui, m.theme); } });
    tracked.update();
    tracked.toggleCollapse();
    tui.terminal.rows = 6;
    trackedWidget.render(40);
    tracked.hideCompletedTasksFromPreviousTurn();
    tracked.toggleCollapse();
    tui.terminal.rows = 30;
    expect(text(m, trackedWidget)).toContain("Done");
    tui.terminal.rows = 6;
    trackedWidget.render(40);
    tracked.hideCompletedTasksFromPreviousTurn();
    tui.terminal.rows = 30;
    expect(text(m, trackedWidget)).not.toContain("Done");
    tracked.resetCompletedDisplayState();
    expect(text(m, trackedWidget)).toContain("Done");
  }
});

realTest("compact Todo counts remain factual when several active or only completed tasks overflow", async () => {
  const m = await real();
  let widget: any;
  let cap = 2;
  let expanded = false;
  m.store.__resetState();
  m.store.setActiveRenderSession("compact-counts");
  const overlay = new m.TodoOverlay();
  const ctx = { theme: m.theme, getToolsExpanded: () => expanded,
    setWidget(_key: string, factory: any) { widget = factory({ requestRender() {}, configsActivityRows: () => cap }, m.theme); } };
  overlay.setUICtx(ctx);
  for (const status of ["in_progress", "completed", "pending"]) {
    m.store.replaceState("compact-counts", { tasks: [task(1, status), task(2, status), task(3, status)], nextId: 4 });
    overlay.resetCompletedDisplayState();
    overlay.update();
    for (cap of [1, 2, 3, 4]) {
      const lines = widget.render(80).map(m.tui.stripTerminalSequences);
      expect(lines.length).toBeLessThanOrEqual(cap);
      const shown = lines.join("\n").match(/Task \d/g)?.length ?? 0;
      const hidden = 3 - shown;
      if (hidden) expect(lines[0]).toContain(`+${hidden} more`);
      else expect(lines[0]).not.toContain("more");
      expect(lines.every((line: string) => line.trim())).toBe(true);
    }
  }
  const configPath = join(m.home, ".config/rpiv-todo/config.json");
  writeFileSync(configPath, '{"maxWidgetLines":3,"collapseKey":"off"}');
  cap = 7;
  m.store.replaceState("compact-counts", { tasks: Array.from({ length: 9 }, (_, i) => task(i + 1, "pending")), nextId: 10 });
  expect(widget.render(80)).toHaveLength(3);
  expanded = true;
  expect(widget.render(80)).toHaveLength(7);
  ctx.theme = { ...m.theme, fg: (_: string, value: string) => value.toUpperCase(), strikethrough: (value: string) => value };
  widget.invalidate();
  expect(text(m, widget)).toContain("TODOS");
  expect(expanded).toBe(true);
});

realTest("/todos stays a notification with IDs, ordered status groups, active form and sanitized rows", async () => {
  const m = await real();
  m.store.__resetState();
  const state = { tasks: [task(1, "completed", "Done"), task(2, "in_progress", "Running"),
    task(3, "pending", "Pending\x1b[41m subject"), task(4, "deleted", "Hidden")], nextId: 5 };
  m.store.replaceState("command", state);
  let command: any;
  m.registerTodosCommand({ registerCommand(_name: string, value: any) { command = value; } });
  const notifications: [string, string][] = [];
  const ctx = { hasUI: true, ui: { theme: m.theme, notify(message: string, type: string) { notifications.push([message, type]); } },
    sessionManager: { getSessionId: () => "command" } };
  await command.handler("", ctx);
  const [message, level] = notifications.pop()!;
  expect(level).toBe("info");
  const plain = m.tui.stripTerminalSequences(message);
  expect(plain).toContain("◇ 1/3 completed · 1 in progress · 1 pending");
  expect(plain).toContain("╰─ ◇ #3 Pending subject");
  expect(plain).toContain("╰─ ◈ #2 Running (checking 漢字 é)");
  expect(plain).toContain("╰─ ✓ #1 Done");
  for (const line of plain.split("\n")) expect(line).toBe(line.trimStart());
  expect(m.formatCommandTaskLine(task(3, "pending", "Plain"), "○")).toBe("  ○ #3 Plain");
  expect(plain.indexOf("#3")).toBeLessThan(plain.indexOf("#2"));
  expect(plain.indexOf("#2")).toBeLessThan(plain.indexOf("#1"));
  expect(plain).not.toContain("Hidden");
  // Exercise native showStatus, not literal spaces plus an invented wrapper.
  // The unpatched SDK uses one column; the shared transcript patch will own
  // the adaptive body gutter. Both first and continued lines must use that
  // same native gutter, whatever width is requested.
  const { InteractiveMode } = await import(pathToFileURL(join(sdk!, "dist/modes/interactive/interactive-mode.js")).href);
  const app = Object.create(InteractiveMode.prototype);
  Object.assign(app, { chatContainer: new m.tui.Container(), outputPad: 1, ui: { requestRender() {} } });
  app.showStatus("marker");
  const marker = app.lastStatusText;
  app.lastStatusText = undefined;
  app.showStatus(message);
  const notification = app.lastStatusText;
  assertWidths(m, width => notification.render(width));
  for (const width of [4, 8, 20, 80]) {
    const nativeIndent = text(m, marker, width).split("\n")[0].match(/^ */)![0].length;
    const lines = notification.render(width).map(m.tui.stripTerminalSequences);
    const wrapped = m.tui.wrapTextWithAnsi(message, Math.max(1, width - nativeIndent * 2)).map(m.tui.stripTerminalSequences);
    if (width <= 20) expect(lines.length).toBeGreaterThan(plain.split("\n").length);
    expect(lines).toHaveLength(wrapped.length);
    for (let i = 0; i < lines.length; i++) {
      // The native wrapper can retain a content space at a word boundary;
      // compare the actual wrapped content, not its first non-space glyph.
      expect(lines[i].trimEnd()).toBe((" ".repeat(nativeIndent) + wrapped[i]).trimEnd());
    }
  }
  expect(m.store.getState("command")).toBe(state);
  m.store.replaceState("command", { tasks: [], nextId: 1 });
  await command.handler("", ctx);
  expect(m.tui.stripTerminalSequences(notifications.pop()![0])).toBe("◇ No todos yet. Ask the agent to add some!");
  await command.handler("", { ...ctx, hasUI: false });
  expect(notifications.pop()).toEqual(["/todos requires interactive mode", "error"]);
});

realTest("explicit and automatic clear notifications share chrome without changing session entries or conditions", async () => {
  const m = await real();
  m.store.__resetState();
  const commands = new Map<string, any>();
  const events = new Map<string, Function[]>();
  const entries: [string, any][] = [];
  const notices: [string, string][] = [];
  const widgets: [string, unknown][] = [];
  m.registerExtension({
    registerTool() {}, registerShortcut() {},
    registerCommand(name: string, command: any) { commands.set(name, command); },
    on(name: string, handler: Function) { events.set(name, [...events.get(name) ?? [], handler]); },
    appendEntry(type: string, data: any) { entries.push([type, data]); },
  }, async () => ({ TodoOverlay: m.TodoOverlay }));
  const ctx = { hasUI: true, sessionManager: {
    getSessionId: () => "clear-test",
    // Historical backend compatibility ONLY in this fake context. Never append
    // fabricated tool results to a real Pi session during UI tests.
    appendMessage(message: any) { entries.push([message.role, message.details]); return "fixture-entry"; },
  },
    ui: { theme: m.theme, notify(message: string, level: string) { notices.push([message, level]); },
      setWidget(name: string, value: unknown) { widgets.push([name, value]); } } };
  const notice = () => {
    const [message, level] = notices.pop()!;
    expect(level).toBe("info");
    expect(message).toContain(m.theme.fg("accent", "◇"));
    return m.tui.stripTerminalSequences(message);
  };
  const clear = () => commands.get("todos-clear").handler("", ctx);
  const dispatch = async (isError = false) => {
    for (const handler of events.get("tool_execution_end") ?? []) await handler({ toolName: "todo", isError }, ctx);
  };
  const initial = { tasks: [task(1, "pending"), task(2, "completed")], nextId: 3 };
  m.store.replaceState("clear-test", initial);
  await clear();
  expect(notice()).toBe("◇ Cleared 2 todos");
  expect(m.store.getState("clear-test").tasks).toEqual([]);
  expect(initial.tasks).toHaveLength(2);
  expect(widgets.pop()).toEqual(["rpiv-todos", undefined]);
  expect(entries).toHaveLength(1);
  const persistenceKind = edits["index.ts"][1][0].includes("appendMessage") ? "toolResult" : "rpiv-todo";
  expect(entries[0][0]).toBe(persistenceKind);
  expect(entries[0][1].action).toBe("clear");
  expect(entries[0][1].tasks).toEqual([]);

  await clear();
  expect(notice()).toBe("◇ No todos to clear");
  expect(entries).toHaveLength(2);
  m.store.replaceState("clear-test", { tasks: [task(3, "pending")], nextId: 4 });
  await dispatch();
  expect(entries).toHaveLength(2);
  expect(notices).toHaveLength(0);
  m.store.replaceState("clear-test", { tasks: [task(3, "completed")], nextId: 4 });
  await dispatch(true);
  expect(entries).toHaveLength(2);
  await dispatch();
  expect(notice()).toBe("◇ All todos done — cleared");
  expect(entries).toHaveLength(3);
  expect(m.store.getState("clear-test").tasks).toEqual([]);
  await dispatch();
  expect(notices).toHaveLength(0);
  expect(entries).toHaveLength(3);

  m.store.replaceState("clear-test", { tasks: [task(4, "pending")], nextId: 5 });
  await clear();
  expect(notice()).toBe("◇ Cleared 1 todo");
  await commands.get("todos-clear").handler("", { ...ctx, hasUI: false });
  expect(notices).toHaveLength(0);
  expect(entries).toHaveLength(5);
  for (const [kind, details] of entries) {
    expect(kind).toBe(persistenceKind);
    expect(details.action).toBe("clear");
    expect(details.tasks).toEqual([]);
    expect(details.nextId).toBe(m.store.getState("clear-test").nextId);
  }
});
