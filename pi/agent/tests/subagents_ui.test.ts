import { afterAll, expect } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { applySdkPatches, checkProcess as check, copyPackageSources, copySdk, describePatch, patchModule, temporaryDirectory } from "./support/patch_fixtures";
import { nativeSuite } from "./support/native_suite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const patcher = fileURLToPath(new URL("../patches/subagents_ui.py", import.meta.url));
const pkg = process.env.PI_SUBAGENTS_ROOT ?? join(homedir(), ".pi/agent/npm/node_modules/@tintinweb/pi-subagents");
const sdkSource = process.env.PI_SDK_ROOT;
const temp = temporaryDirectory("subagents-ui-test-");
const sdk = join(temp, "sdk");
const { child, unitTest: test, nativeTest: realTest } = nativeSuite(import.meta.path, !!sdkSource && existsSync(pkg));
// Some replacements introduce later anchors. Build minimal counted seams in
// patch order, then reverse them; guard fixtures need no installed package.
const { sources, module: modulePath, streamFile, streamEdit } = describePatch<{
  sources: Record<string, string>;
  module: string;
  streamFile: string;
  streamEdit: [string, string];
}>(
  patcher, "{'sources':sources,'module':m['MODULE'],'streamFile':m['STREAM_FILE'],'streamEdit':m['STREAM_EDIT']}", `
sources = {}
for name, edits in m['EDITS'].items():
    source = ''
    for old, new, count in edits:
        missing = count - source.count(old)
        assert missing >= 0, (name, old)
        source += '\\n' + (old + '\\n') * missing
        source = source.replace(old, new)
    sources[name] = m['transform'](name, source, True)
    assert m['transform'](name, sources[name]) == source
`);
sources[streamFile] = streamEdit[0] + "\n";
const files = Object.keys(sources);
const allSourceFiles = [...files, modulePath];
const run = (root: string) => Bun.spawnSync(["python3", "-B", patcher], { env: { ...process.env, PI_SUBAGENTS_ROOT: root, HOME: root } });
function sandbox(name: string, native = false) {
  const root = join(temp, name);
  mkdirSync(root, { recursive: true });
  if (!native) {
    for (const [file, source] of Object.entries(sources)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), source);
    }
    writeFileSync(join(root, "package.json"), '{"version":"0.19.0","type":"module"}');
    return root;
  }
  copyPackageSources(join(pkg, "src"), join(root, "src"));
  copyFileSync(join(pkg, "package.json"), join(root, "package.json"));
  // Normalize only a complete, validated installation. Live sources stay read-only.
  const result = patchModule(patcher, `
root=pathlib.Path(sys.argv[2])
s={n:(root/n).read_text() for n in m['EDITS']}
if (root/m['MODULE']).exists(): s[m['MODULE']]=(root/m['MODULE']).read_text()
s[m['STREAM_FILE']] = (root/m['STREAM_FILE']).read_text()
m['patch_sources'](s)
if all(v.startswith(m['MARKER']) for n,v in s.items() if n in m['EDITS']):
 for n in m['EDITS']: (root/n).write_text(m['transform'](n,s[n].removeprefix(m['MARKER']+'\\n'),True))
 (root/m['MODULE']).unlink()
`, [root]);
  check(result);
  return root;
}

function contents(root: string) {
  return Object.fromEntries([...files, modulePath].map(file => [file,
    existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : null]));
}

test("complete previous helper migrates with an exact backup; modified helpers still refuse", () => {
  const root = sandbox("previous-helper");
  expect(run(root).exitCode).toBe(0);
  const current = readFileSync(join(root, modulePath), "utf8");
  const legacy = readFileSync(new URL("../patches/payloads/subagents/legacy/subagents_ui.ts.inc", import.meta.url), "utf8");
  const backups = join(root, ".config/theme-backups");
  const before = readdirSync(backups);
  writeFileSync(join(root, modulePath), legacy);
  expect(run(root).exitCode).toBe(0);
  expect(readFileSync(join(root, modulePath), "utf8")).toBe(current);
  const added = readdirSync(backups).filter(name => !before.includes(name));
  expect(added).toHaveLength(1);
  expect(readFileSync(join(backups, added[0], modulePath), "utf8")).toBe(legacy);
  expect(JSON.parse(readFileSync(join(backups, added[0], "added-files.json"), "utf8"))).toEqual([]);
  expect(run(root).exitCode).toBe(0);
  expect(readdirSync(backups)).toHaveLength(before.length + 1);

  writeFileSync(join(root, modulePath), legacy + "\n// local helper edit");
  expect(run(root).exitCode).not.toBe(0);
  expect(readFileSync(join(root, modulePath), "utf8")).toBe(legacy + "\n// local helper edit");
  expect(readdirSync(backups)).toHaveLength(before.length + 1);
});

test("compact widget migrates each complete predecessor and refuses modified source before writes", () => {
  for (const helper of ["LEGACY_MODULE_SOURCE", "PRE_COMPACT_MODULE_SOURCE"]) {
    const root = sandbox(`pre-compact-${helper}`);
    check(run(root));
    check(patchModule(patcher, `
root=pathlib.Path(sys.argv[2])
name=m['WIDGET']
source=(root/name).read_text().removeprefix(m['MARKER']+'\\n')
original=m['transform'](name,source,True)
previous=m['replace_counted'](original,m['LEGACY_WIDGET_EDITS'],'previous widget')
(root/name).write_text(m['MARKER']+'\\n'+previous)
(root/m['MODULE']).write_text(m[sys.argv[3]])
`, [root, helper]));
    const before = contents(root);
    const backups = join(root, ".config/theme-backups");
    const previousBackups = readdirSync(backups);
    check(run(root));
    expect(contents(root)["src/ui/agent-widget.ts"]).toContain("configs:subagents-compact-widget-v1");
    const added = readdirSync(backups).filter(name => !previousBackups.includes(name));
    expect(added).toHaveLength(1);
    for (const file of allSourceFiles) {
      expect(readFileSync(join(backups, added[0], file), "utf8")).toBe(before[file]!);
    }
    expect(JSON.parse(readFileSync(join(backups, added[0], "added-files.json"), "utf8"))).toEqual([]);
    const after = contents(root);
    check(run(root));
    expect(contents(root)).toEqual(after);
    expect(readdirSync(backups)).toHaveLength(previousBackups.length + 1);

    // An exact historical helper cannot authorize replacing edited widget code.
    for (const [file, source] of Object.entries(before)) writeFileSync(join(root, file), source!);
    const widget = join(root, "src/ui/agent-widget.ts");
    writeFileSync(widget, readFileSync(widget, "utf8").replace("this.renderWidget(inner, theme)", "this.renderWidget(inner, customTheme)"));
    const modified = contents(root);
    expect(run(root).exitCode).not.toBe(0);
    expect(contents(root)).toEqual(modified);
    expect(readdirSync(backups)).toHaveLength(previousBackups.length + 1);
  }
});

test("compact panels migrate complete predecessors, but never a mixed or edited panel stage", () => {
  const root = sandbox("panel-migration");
  check(run(root));
  const current = contents(root);
  check(patchModule(patcher, `
root=pathlib.Path(sys.argv[2])
for name,edits in m['PANEL_EDITS'].items():
 source=(root/name).read_text()
 (root/name).write_text(m['replace_counted'](source,edits,'old panel',reverse=True))
`, [root]));
  const previous = contents(root);
  const backups = join(root, ".config/theme-backups");
  const before = readdirSync(backups);
  check(run(root));
  expect(contents(root)).toEqual(current);
  const added = readdirSync(backups).filter(name => !before.includes(name));
  expect(added).toHaveLength(1);
  for (const file of allSourceFiles) {
    expect(readFileSync(join(backups, added[0], file), "utf8")).toBe(previous[file]!);
  }
  check(run(root));
  expect(readdirSync(backups)).toHaveLength(before.length + 1);
  for (const mode of ["mixed", "edited"]) {
    for (const [file, source] of Object.entries(current)) writeFileSync(join(root, file), source!);
    const file = "src/ui/conversation-viewer.ts";
    writeFileSync(join(root, file), mode === "mixed" ? previous[file]! : current[file]!.replace("this.renderCompact(width)", "this.renderCompact(width - 1)"));
    const invalid = contents(root);
    expect(run(root).exitCode).not.toBe(0);
    expect(contents(root)).toEqual(invalid);
    expect(readdirSync(backups)).toHaveLength(before.length + 1);
  }
});

test("absent installation is skipped without creating it", () => {
  const root = join(temp, "absent");
  check(run(root));
  expect(existsSync(root)).toBe(false);
});

test("validate all sources before writes; exact backups, unrelated edits and repeatability", () => {
  const root = sandbox("backup");
  writeFileSync(join(root, "src/index.ts"), readFileSync(join(root, "src/index.ts"), "utf8") + "\n// unrelated local edit\n");
  const before = contents(root);
  check(run(root));
  const after = contents(root);
  const backups = readdirSync(join(root, ".config/theme-backups"));
  expect(backups).toHaveLength(1);
  for (const file of files) {
    expect(readFileSync(join(root, ".config/theme-backups", backups[0], file), "utf8")).toBe(before[file]!);
  }
  expect(after["src/index.ts"]).toContain("// unrelated local edit");
  expect(JSON.parse(readFileSync(join(root, ".config/theme-backups", backups[0], "added-files.json"), "utf8"))).toEqual([modulePath]);
  check(run(root));
  expect(contents(root)).toEqual(after);
  expect(readdirSync(join(root, ".config/theme-backups"))).toEqual(backups);
});

test("output stream patch rejects changed or duplicated anchors", () => {
  const root = sandbox("stream-anchor");
  check(run(root));
  const current = contents(root);
  const stream = join(root, streamFile);
  const changed = current[streamFile]!.replace(streamEdit[1], `${streamEdit[1]} // local edit`);
  writeFileSync(stream, changed);
  const before = contents(root);
  expect(run(root).exitCode).not.toBe(0);
  expect(contents(root)).toEqual(before);

  writeFileSync(stream, current[streamFile]!.replace(streamEdit[1], `${streamEdit[1]}\n${streamEdit[1]}`));
  const duplicate = contents(root);
  expect(run(root).exitCode).not.toBe(0);
  expect(contents(root)).toEqual(duplicate);
});

test("unknown versions, changed/duplicate anchors and partial installations refuse before writes", () => {
  for (const mode of ["version", "changed", "duplicate", "partial", "missing-helper", "changed-helper", "unexpected-helper", "residual-original"]) {
    const root = sandbox(mode);
    if (mode === "version") writeFileSync(join(root, "package.json"), '{"version":"0.20.0"}');
    else if (mode === "changed") writeFileSync(join(root, "src/index.ts"), readFileSync(join(root, "src/index.ts"), "utf8").replace('renderCall(args, theme, context) {', 'renderCall( args, theme, context) {'));
    else if (mode === "duplicate") writeFileSync(join(root, "src/index.ts"), readFileSync(join(root, "src/index.ts"), "utf8") + 'renderCall(args, theme, context) {');
    else if (mode === "unexpected-helper") writeFileSync(join(root, modulePath), "user-owned file");
    else {
      const original = readFileSync(join(root, "src/index.ts"), "utf8");
      check(run(root));
      if (mode === "partial") writeFileSync(join(root, "src/index.ts"), original);
      else if (mode === "missing-helper") rmSync(join(root, modulePath));
      else if (mode === "changed-helper") writeFileSync(join(root, modulePath), "user-owned changed helper");
      else writeFileSync(join(root, "src/index.ts"), readFileSync(join(root, "src/index.ts"), "utf8") + 'renderCall(args, theme, context) {');
    }
    const before = contents(root);
    expect(run(root).exitCode).not.toBe(0);
    expect(contents(root)).toEqual(before);
  }
});

let loaded: Promise<any> | undefined;
function real() {
  return loaded ??= (async () => {
    copySdk(sdkSource!, sdk);
    applySdkPatches(sdk, ["pi_horizontal_inset", "pi_transcript", "pi_compact_layout"]);
    const root = sandbox("real", true);
    check(run(root));
    // Package dependencies remain read-only. Resolve SDK peers to Pi's own copy.
    const modules = join(root, "node_modules");
    mkdirSync(join(modules, "@earendil-works"), { recursive: true });
    for (const name of ["@sinclair", "croner", "nanoid", "typebox"]) {
      symlinkSync(join(dirname(dirname(pkg)), name), join(modules, name));
    }
    for (const name of ["pi-coding-agent", "pi-tui", "pi-ai", "pi-agent-core"]) {
      const target = name === "pi-coding-agent" ? sdk! : join(sdk!, "node_modules/@earendil-works", name);
      symlinkSync(target, join(modules, "@earendil-works", name));
    }
    const load = (file: string) => import(pathToFileURL(join(root, "src", file)).href);
    const tui = await import(pathToFileURL(join(sdk!, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);
    const colors = await import(pathToFileURL(join(sdk!, "dist/modes/interactive/theme/theme.js")).href);
    colors.setThemeInstance(colors.loadThemeFromPath(fileURLToPath(new URL("../themes/osaka-jade.json", import.meta.url)), "truecolor"));
    return { root, load, tui, colors, theme: colors.theme,
      ...await load("agent-color.ts"), ...await load("ui/agent-chrome.ts"), ...await load("ui/agent-widget.ts"),
      ...await load("ui/fleet-list.ts"), ...await load("ui/conversation-viewer.ts"), ...await load("ui/workflow-card.ts"),
      ...await load("ui/workflow-dialog.ts"), ...await load("ui/select-item.ts"), ...await load("ui/agent-mention.ts"),
    };
  })();
}
const plain = (m: any, lines: string[]) => lines.map(m.tui.stripTerminalSequences).join("\n");

realTest("output transcripts flush completed messages before the agent turn settles", async () => {
  const m = await real();
  const { streamToOutputFile, writeInitialEntry } = await m.load("output-file.ts");
  const output = join(temp, "live.output");
  writeInitialEntry(output, "agent", "inspect the change", temp);

  const messages = [{ role: "user", content: [{ type: "text", text: "inspect the change" }] }];
  let emit: ((event: unknown) => void) | undefined;
  const session = {
    messages,
    subscribe(listener: (event: unknown) => void) {
      emit = listener;
      return () => { emit = undefined; };
    },
  };
  const cleanup = streamToOutputFile(session, output, "agent", temp);
  const assistant = { role: "assistant", content: [{ type: "text", text: "I am inspecting it." }] };
  messages.push(assistant);
  emit?.({ type: "message_end", message: assistant });
  expect(readFileSync(output, "utf8")).toContain(JSON.stringify(assistant));

  // No turn_end has fired: a tool result should still become visible now.
  const toolResult = { role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text: "done" }] };
  messages.push(toolResult);
  emit?.({ type: "message_end", message: toolResult });
  expect(readFileSync(output, "utf8")).toContain(JSON.stringify(toolResult));
  cleanup();
});
function within(m: any, lines: string[], width: number) {
  for (const line of lines) expect(m.tui.visibleWidth(line)).toBeLessThanOrEqual(width);
}
const noBackground = (lines: string[]) => expect(lines.join("\n")).not.toMatch(/\x1b\[(?:4[0-8]|10[0-7]|48;[^m]*)m/);
const record = (status = "running", id = "one") => ({
  id, type: "Explore", status, description: "Inspect 界 auth ◆ user content", startedAt: Date.now() - 12_000,
  completedAt: ["running", "queued"].includes(status) ? undefined : Date.now(),
  toolUses: 3, error: status === "error" ? "permission denied" : undefined,
  lifetimeUsage: { input: 100, output: 200, cacheRead: 0, cacheWrite: 0, totalTokens: 300, cost: { total: 0.02 } },
});
const preview: string[] = [];
afterAll(() => {
  if (child && process.env.SUBAGENTS_UI_PREVIEW && preview.length) writeFileSync(process.env.SUBAGENTS_UI_PREVIEW, preview.join("\n") + "\n");
});

realTest("shared foreground-only labels, geometric states and gutter preserve Unicode, images and cursor markers", async () => {
  const m = await real();
  const states = ["running", "queued", "completed", "steered", "stopped", "aborted", "error", "background"];
  const labels = states.map(status => m.agentState(status, m.theme));
  expect(plain(m, labels).split("\n")).toEqual(["◌", "○", "✓", "✓", "■", "×", "×", "◌"]);
  for (const color of ["red", "#439187", undefined]) {
    const name = m.renderAgentNameLabel("Worker 界", color, m.theme, { bold: true });
    expect(m.tui.stripTerminalSequences(name)).toBe("Worker 界");
    noBackground([name]);
  }
  const marker = "\x1b_pi:c\x07";
  for (const width of [1, 2, 4, 8, 12, 40, 80]) {
    const lines = m.renderAgentBody(width, () => [`${marker}◆ 界 more`]);
    within(m, lines, width);
    if (width > 1) expect(lines.join("\n")).toContain(marker);
  }
  const image = "\x1b_Ga=T,f=100;AAAA\x1b\\";
  expect(m.renderAgentBody(30, () => [image])[0]).toBe(" " + image);
  for (const width of [1, 2, 4, 40, 79, 80, 120]) {
    const expected = Math.min(width < 80 ? 1 : 3, Math.max(0, Math.floor((width - 2) / 2)));
    expect(m.agentBodyWidth(width).pad).toBe(expected);
    expect(m.agentBodyWidth(width, 0).pad).toBe(0);
    expect(m.renderAgentBody(width, () => ["literal"], 0)[0]).not.toStartWith(" ");
  }
});

realTest("AgentWidget uses render width, rounded branches, all states and real activity without badges", async () => {
  const m = await real();
  let component: any;
  const agents = [record("completed"), record("running", "two"), record("queued", "three")];
  const activity = new Map([["two", { activeTools: new Map([["read", "read"]]), toolUses: 2, responseText: "", turnCount: 2 }]]);
  const widget = new m.AgentWidget({ listAgents: () => agents }, activity);
  widget.setUICtx({ setStatus() {}, setWidget(_key: string, factory: any) {
    if (factory) component = factory({ terminal: { get columns() { throw new Error("must use render width"); } }, requestRender() {} }, m.theme);
  } });
  widget.update();
  for (const width of [1, 4, 8, 20, 80]) within(m, component.render(width), width);
  const lines = component.render(110);
  noBackground(lines);
  expect(plain(m, lines)).toContain("   ◈ Agents");
  expect(plain(m, lines)).toContain("╰─");
  expect(plain(m, lines)).toContain("1 queued");
  preview.push("AgentWidget", ...lines);
  for (const status of ["completed", "steered", "stopped", "aborted", "error"]) {
    agents.splice(0, agents.length, record(status));
    const rendered = plain(m, component.render(120));
    if (status !== "completed") expect(rendered).toContain(status === "steered" ? "turn limit" : status);
  }
  agents.splice(0, agents.length, record("running", "literal"));
  activity.set("literal", { activeTools: new Map(), toolUses: 0, responseText: "keep ├─ and ⎿ intact", turnCount: 1 });
  expect(plain(m, component.render(120))).toContain("keep ├─ and ⎿ intact");
  component.invalidate();
  widget.dispose();
});

realTest("compact AgentWidget budgets heading and useful rows without changing records, modes or linger", async () => {
  const m = await real();
  let component: any;
  let cap = Infinity;
  let reads = 0;
  let mode = "all";
  const agents = [
    ...["r1", "r2", "r3"].map(id => record("running", id)),
    record("queued", "q1"), record("queued", "q2"),
    record("error", "e"), record("aborted", "a"), record("steered", "s"), record("stopped", "x"),
    record("completed", "c1"), record("completed", "c2"),
  ];
  for (const agent of agents) Object.freeze(agent);
  const before = JSON.stringify(agents);
  const widget = new m.AgentWidget({ listAgents: () => agents }, new Map(), () => mode,
    () => { throw new Error("compact preview must not compute dense cost metadata"); },
    () => { throw new Error("compact preview must not compute dense model metadata"); });
  widget.setUICtx({ setStatus() {}, setWidget(_key: string, factory: any) {
    if (factory) component = factory({ terminal: { columns: 120 }, requestRender() {},
      configsActivityRows: () => { reads++; return cap; } }, m.theme);
  } });
  widget.update();
  widget.markFinished("e");
  const ages = [...widget.finishedTurnAge];
  const frame = widget.widgetFrame;
  for (const budget of [1, 2, 3, 6]) {
    cap = budget;
    for (const width of [40, 79, 80, 120]) {
      const lines = component.render(width);
      within(m, lines, width);
      expect(lines).toHaveLength(budget);
      noBackground(lines);
      const heading = m.tui.stripTerminalSequences(lines[0]);
      // Totals are exact even when their detail rows cannot fit. The narrow
      // labels distinguish errors from abort/turn-limit/stop outcomes.
      if (width < 80) {
        for (const count of ["3r", "2q", "1err", "1ab", "1lim", "1stop", "2✓"]) expect(heading).toContain(count);
      } else {
        for (const count of ["3 running", "2 queued", "1 error", "1 aborted", "1 turn limit", "1 stopped", "2 done"]) {
          if (width === 120) expect(heading).toContain(count);
        }
      }
      expect(heading).toContain(`+${9 - (budget - 1)}`);
      if (budget >= 2) expect(plain(m, [lines[1]])).toContain("Inspect 界");
      if (budget >= 3) expect(plain(m, lines)).toContain("error: permission denied");
    }
  }
  expect(reads).toBe(16);
  expect(widget.finishedTurnAge).toEqual(new Map(ages));
  expect(widget.widgetFrame).toBe(frame);
  expect(JSON.stringify(agents)).toBe(before);

  // Width alone compacts metadata on an unbounded-height host.
  cap = Infinity;
  within(m, component.render(40), 40);
  mode = "off";
  expect(component.render(40)).toEqual([]);
  mode = "all";
  agents.splice(0, agents.length, record("completed", "finished"), record("error", "failed"));
  for (const budget of [1, 2, 3, 6]) {
    cap = budget;
    const lines = component.render(120);
    expect(lines).toHaveLength(Math.min(budget, 3));
    expect(plain(m, [lines[0]])).toContain("1 error 1 done");
    if (budget >= 2) expect(plain(m, [lines[1]])).toContain("error: permission denied");
  }
  agents.splice(0, agents.length, record("queued", "only-queue"));
  cap = 1;
  expect(plain(m, component.render(40))).toContain("1 queued");
  widget.dispose();
});

realTest("AgentWidget reads the shared host allowance after resize and Todo registration changes", async () => {
  const m = await real();
  const { installActivityBudget } = await import(pathToFileURL(join(sdk, "dist/modes/interactive/components/compact-layout.js")).href);
  const tui = { terminal: { rows: 14 }, requestRender() {} };
  const above = new Map();
  installActivityBudget(tui, above, new Map());
  let component: any;
  const agents = Array.from({ length: 6 }, (_, index) => record("running", `r${index}`));
  const widget = new m.AgentWidget({ listAgents: () => agents }, new Map());
  widget.setUICtx({ setStatus() {}, setWidget(key: string, factory: any) {
    if (factory) {
      above.set(key, factory);
      component = factory(tui, m.theme);
    } else above.delete(key);
  } });
  widget.update();
  expect(component.render(100)).toHaveLength(4);
  above.set("rpiv-todos", {});
  expect(component.render(120)).toHaveLength(2);
  component.invalidate();
  // Native lifecycle clears the manager's cache before registering again.
  // The existing component must still read its factory's live TUI budget.
  expect(widget.tui).toBeUndefined();
  expect(widget.widgetRegistered).toBe(false);
  expect(component.render(120)).toHaveLength(2);
  above.delete("rpiv-todos");
  expect(component.render(120)).toHaveLength(4);
  tui.terminal.rows = 18;
  expect(component.render(100)).toHaveLength(6);
  tui.terminal.rows = 24;
  expect(component.render(100).length).toBeGreaterThan(6);
  widget.dispose();
});

realTest("resizing back to full height restores byte-identical original AgentWidget output", async () => {
  const m = await real();
  const previousFile = join(m.root, "src/ui/agent-widget-previous.ts");
  check(patchModule(patcher, `
root=pathlib.Path(sys.argv[2])
source=(root/m['WIDGET']).read_text().removeprefix(m['MARKER']+'\\n')
original=m['transform'](m['WIDGET'],source,True)
pathlib.Path(sys.argv[3]).write_text(m['replace_counted'](original,m['LEGACY_WIDGET_EDITS'],'previous widget'))
`, [m.root, previousFile]));
  const previous = await import(pathToFileURL(previousFile).href);
  const agents = [record("running", "r"), record("queued", "q"), record("error", "e"), record("completed", "c")];
  let cap = Infinity;
  const create = (Widget: any, patchedHost: boolean) => {
    let component: any;
    const widget = new Widget({ listAgents: () => agents }, new Map());
    widget.setUICtx({ setStatus() {}, setWidget(_key: string, factory: any) {
      if (factory) component = factory({ terminal: { columns: 120 }, requestRender() {},
        ...(patchedHost ? { configsActivityRows: () => cap } : {}) }, m.theme);
    } });
    widget.update();
    return { widget, component };
  };
  const current = create(m.AgentWidget, true);
  const fallback = create(m.AgentWidget, false);
  const old = create(previous.AgentWidget, false);
  const now = Date.now;
  try {
    const fixed = now();
    Date.now = () => fixed;
    for (const width of [80, 120]) {
      const baseline = old.component.render(width);
      expect(current.component.render(width)).toEqual(baseline);
      expect(fallback.component.render(width)).toEqual(baseline);
      cap = 2;
      expect(current.component.render(width)).toHaveLength(2);
      cap = Infinity;
      expect(current.component.render(width)).toEqual(baseline);
    }
  } finally {
    Date.now = now;
    current.widget.dispose();
    fallback.widget.dispose();
    old.widget.dispose();
  }
});

realTest("FleetView keeps focus, selection, navigation and workflow rows inside the shared gutter", async () => {
  const m = await real();
  let component: any;
  const agents = [record("running")];
  agents[0].session = { messages: [], subscribe: () => () => {} };
  const tui = { focusedComponent: undefined, requestRender() {} };
  const fleet = new m.FleetList({ listAgents: () => agents }, new Map());
  fleet.setWorkflowSource(() => [{ id: "workflow", name: "Review 界", status: "running", doneCount: 1, totalCount: 3, startedAt: Date.now(), tokens: 42 }], () => {});
  fleet.setUICtx({ setWidget(_key: string, factory: any) { if (factory) component = factory(tui, m.theme); },
    onTerminalInput: () => () => {}, getEditorText: () => "", notify() {}, custom() { throw new Error("not opening a viewer"); } });
  fleet.update();
  for (const width of [1, 4, 8, 20, 80]) within(m, component.render(width), width);
  expect(plain(m, component.render(120))).toContain("   ● main");
  expect(fleet.handleKey("\x1b[B")).toEqual({ consume: true });
  expect(fleet.handleKey("\x1b[B")).toEqual({ consume: true });
  expect(plain(m, component.render(120))).toContain("● ◈ workflow");
  tui.focusedComponent = {};
  expect(fleet.handleKey("\x1b[B")).toBeUndefined();
  preview.push("FleetView", ...component.render(110));
  noBackground(component.render(110));
  fleet.dispose();
});

realTest("conversation viewer preserves Pi/You identity, literal user glyphs, markdown, steering cursor and stop controls", async () => {
  const m = await real();
  const messages = [{ role: "user", content: "Please keep ⎿ [Assistant] and 界 intact" },
    { role: "assistant", content: [{ type: "text", text: "**Found** the issue." }, { type: "toolCall", name: "read" }] },
    { role: "toolResult", content: [{ type: "text", text: "result 界" }] }];
  let steered = "";
  let stopped = 0;
  let closed = 0;
  const viewer = new m.ConversationViewer({ terminal: { rows: 40 }, requestRender() {} },
    { messages, subscribe: () => () => {} }, record(), undefined, m.theme, () => closed++, () => stopped++, undefined,
    (text: string) => steered = text);
  for (const width of [1, 4, 6, 8, 20, 80]) within(m, viewer.render(width), width);
  let lines = viewer.render(100);
  const text = plain(m, lines);
  expect(text).toContain("◆ You");
  expect(text).toContain("● Pi");
  expect(text).toContain("Please keep ⎿ [Assistant] and 界 intact");
  expect(text).toContain("Found the issue.");
  noBackground(lines);
  preview.push("Conversation", ...lines);
  viewer.handleInput("\r");
  lines = viewer.render(100);
  expect(lines.join("\n")).toContain("\x1b_pi:c\x07");
  viewer.handleInput("hello");
  viewer.handleInput("\r");
  expect(steered).toBe("hello");
  viewer.handleInput("x");
  expect(stopped).toBe(0);
  viewer.handleInput("x");
  expect(stopped).toBe(1);
  expect(viewer.markdownCache.has(messages[1])).toBe(true);
  viewer.handleInput("m");
  viewer.invalidate();
  expect(viewer.markdownCache.has(messages[1])).toBe(false);
  viewer.handleInput("\x1b");
  expect(closed).toBe(1);
  viewer.dispose();
});

const workflowInput = () => ({
  task: { status: "running", workflowName: "Review authentication", startTime: Date.now() - 15_000 },
  progress: [
    { type: "workflow_agent", index: 0, label: "Inspect 界", state: "done", phaseIndex: 0, phaseTitle: "Review", tokens: 320, toolCalls: 3, durationMs: 2200 },
    { type: "workflow_agent", index: 1, label: "Verify", state: "start", phaseIndex: 1, phaseTitle: "Verify", promptPreview: "check\nthese\nfive\ninput\nlines", recordId: "child" },
  ], agentCount: 2,
});

realTest("workflow card/dialog keep geometric trees, all display states, narrow widths and dispatch", async () => {
  const m = await real();
  const input = workflowInput();
  const card = m.renderWorkflowCard(input, m.theme);
  const standalone = m.renderWorkflowCard({ ...input, showToolTitle: true }, m.theme);
  const actions: string[] = [];
  const dialog = new m.WorkflowDialog({ requestRender() {} }, () => input, m.theme, () => actions.push("close"),
    { onKill: () => actions.push("kill"), onPause: () => actions.push("pause"), onOpenAgent: () => actions.push("open") });
  for (const width of [1, 4, 8, 20, 80]) {
    within(m, card.render(width), width);
    within(m, standalone.render(width), width);
    within(m, dialog.render(width), width);
  }
  noBackground(card.render(100));
  expect(plain(m, standalone.render(100))).toContain("   ◈ SubagentWorkflow");
  expect(plain(m, card.render(100))).toContain("╰─");
  const states = ["done", "failed", "skipped", "blocked", "queued", "interrupted", "running"];
  expect(states.map(state => m.dialogRowGlyph(state, m.UNICODE_DIALOG_GLYPHS).color)).toEqual(
    ["muted", "error", "dim", "warning", "dim", "dim", "accent"]);
  dialog.handleInput("p");
  dialog.handleInput("x");
  dialog.handleInput("\x1b");
  expect(actions).toEqual(["pause", "kill", "close"]);
  preview.push("Workflow card", ...standalone.render(110), "Workflow dialog", ...dialog.render(110));
  dialog.dispose();
});

const panelSizes = [[40, 12], [50, 16], [60, 20], [70, 12], [120, 12], [40, 40], [120, 24], [120, 40]];

realTest("conversation chrome and steering fit the actual native overlay cap through both resize directions", async () => {
  const m = await real();
  const terminal = { rows: 40, columns: 120, write() {} };
  const host = new m.tui.TuiMainScreen(terminal);
  const fullscreen = new m.tui.TuiAltScreen(terminal);
  const messages = [{ role: "user", content: Array.from({ length: 80 }, (_, n) => `Line ${n} 界`).join("\n") }];
  const agent = { ...record(), invocation: { modelId: "provider/model-real-id", modelName: "Real model" } };
  let stopped = 0;
  let steered = "";
  let disposed = 0;
  const viewer = new m.ConversationViewer(host, { messages, subscribe: () => () => disposed++ }, agent,
    undefined, m.theme, () => {}, () => stopped++, undefined, (text: string) => steered = text);
  host.requestRender = () => {};
  for (const [width, rows] of [...panelSizes, ...panelSizes.toReversed()]) {
    terminal.columns = width;
    terminal.rows = rows;
    const layout = host.resolveOverlayLayout({ width: "90%", maxHeight: "70%" }, 0, width, rows);
    expect(fullscreen.resolveOverlayLayout({ width: "90%", maxHeight: "70%" }, 0, width, rows)).toEqual(layout);
    const shown = () => viewer.render(layout.width);
    let lines = shown();
    within(m, lines, layout.width);
    expect(lines.length).toBeLessThanOrEqual(layout.maxHeight);
    expect(plain(m, lines)).toContain("Agent");
    expect(plain(m, lines)).toContain("Esc close");
    expect(plain(m, lines)).toContain("x stop");
    expect(plain(m, lines)).toContain("Line 79");
    viewer.handleInput("\x1b[H");
    expect(plain(m, shown())).toContain("You");
    viewer.handleInput("\x1b[F");
    viewer.handleInput("\r");
    viewer.handleInput("Steer 界");
    lines = shown();
    expect(lines.length).toBeLessThanOrEqual(layout.maxHeight);
    expect(lines.join("\n")).toContain("\x1b_pi:c\x07");
    expect(plain(m, lines)).toContain("Esc cancel");
    viewer.handleInput("\r");
    expect(steered).toBe("Steer 界");
    viewer.handleInput("x");
    expect(plain(m, shown())).toContain("STOP");
    viewer.handleInput("m"); // Existing non-stop key disarms confirmation.
  }
  expect(stopped).toBe(0);
  viewer.dispose();
  expect(disposed).toBe(1);
});

realTest("compact workflow panes keep selected last rows and controls visible, and page through detail", async () => {
  const m = await real();
  const terminal = { rows: 12, columns: 40, write() {} };
  const host = new m.tui.TuiMainScreen(terminal);
  host.requestRender = () => {};
  const input = workflowInput();
  input.progress = Array.from({ length: 30 }, (_, index) => ({ type: "workflow_agent", index,
    label: `Agent ${index} 界`, phaseIndex: index, phaseTitle: `Phase ${index}`, state: "start",
    recordId: `record${index}`, promptPreview: Array.from({ length: 30 }, (_, n) => `prompt ${n}`).join("\n") }));
  const actions: string[] = [];
  const dialog = new m.WorkflowDialog(host, () => input, m.theme, () => actions.push("close"), {
    onKill: () => actions.push("stop"), onPause: () => actions.push("pause"), onOpenAgent: () => actions.push("open"),
    onSkipAgent: () => actions.push("skip"), onRetryAgent: () => actions.push("retry"),
  });
  for (let n = 0; n < 40; n++) dialog.handleInput("j");
  expect(dialog.state.selectedPhase).toBe(29);
  for (const [width, rows] of [...panelSizes, ...panelSizes.toReversed()]) {
    terminal.rows = rows;
    terminal.columns = width;
    const layout = host.resolveOverlayLayout({ width: "90%", maxHeight: "70%" }, 0, width, rows);
    const lines = dialog.render(layout.width);
    within(m, lines, layout.width);
    expect(lines.length).toBeLessThanOrEqual(layout.maxHeight);
    const text = plain(m, lines);
    expect(text).toContain("Review authentication");
    expect(text.toLowerCase()).toContain("esc close");
    expect(text).toContain("x stop");
    expect(text).toContain("p pause");
    expect(text).toContain("❯");
    expect(dialog.state.selectedPhase).toBe(29);
  }
  input.progress = input.progress.map(entry => ({ ...entry, phaseIndex: 0, phaseTitle: "Review" }));
  dialog.handleInput("\r");
  for (let n = 0; n < 40; n++) dialog.handleInput("j");
  expect(dialog.state.selectedAgent).toBe(29);
  let lines = dialog.render(34);
  expect(plain(m, lines)).toContain("PgUp/Dn");
  expect(plain(m, lines)).toContain("s skip");
  expect(plain(m, lines)).toContain("r retry");
  expect(lines.length).toBeLessThanOrEqual(8);
  dialog.handleInput("\r"); // Preserve the existing expand prompt action.
  dialog.render(34);
  for (let n = 0; n < 50; n++) { dialog.handleInput("\x1b[6~"); lines = dialog.render(34); }
  expect(plain(m, lines)).toContain("running).");
  const atEnd = dialog.detailOffset;
  terminal.rows = 40;
  dialog.render(110);
  terminal.rows = 12;
  dialog.render(34);
  expect(dialog.detailOffset).toBe(atEnd);
  expect(dialog.state.promptExpanded).toBe(true);
  dialog.handleInput("\x1b[5~");
  dialog.render(34);
  expect(dialog.detailOffset).toBeLessThan(atEnd);
  dialog.handleInput("p");
  dialog.handleInput("x");
  dialog.handleInput("c");
  expect(actions).toEqual(["pause", "stop", "open"]);
  dialog.dispose();
});

realTest("FleetList windows its selected roster without losing focus or resize state", async () => {
  const m = await real();
  const agents = Array.from({ length: 30 }, (_, index) => ({ ...record("running", String(index)),
    description: `Target ${index} 界`, startedAt: index, session: { messages: [], subscribe: () => () => {} } }));
  let component: any;
  const host = { terminal: { rows: 40 }, requestRender() {}, focusedComponent: undefined };
  const fleet = new m.FleetList({ listAgents: () => agents }, new Map());
  fleet.setUICtx({ setWidget(_key: string, factory: any) { if (factory) component = factory(host, m.theme); },
    onTerminalInput: () => () => {}, getEditorText: () => "", notify() {} });
  fleet.update();
  for (let n = 0; n < 40; n++) fleet.handleKey("\x1b[B");
  for (const [width, rows] of [...panelSizes, ...panelSizes.toReversed()]) {
    host.terminal.rows = rows;
    const lines = component.render(width);
    within(m, lines, width);
    if (rows < 24) expect(lines.length).toBeLessThanOrEqual(Math.max(2, Math.min(5, Math.floor(rows / 4))));
    expect(plain(m, lines)).toContain("Target 29");
    expect(plain(m, lines)).toContain("●");
    expect(fleet.selectedIndex).toBe(30);
  }
  component.invalidate();
  host.terminal.rows = 12;
  expect(component.render(40)).toHaveLength(3);
  fleet.dispose();
});

realTest("large conversation, workflow and FleetList rendering remains byte-identical after compact resizes", async () => {
  const m = await real();
  check(patchModule(patcher, `
root=pathlib.Path(sys.argv[2])
for name in ['conversation-viewer','workflow-dialog','fleet-list']:
 path='src/ui/'+name+'.ts'
 source=(root/path).read_text()
 previous=m['replace_counted'](source,m['PANEL_EDITS'][path],'previous panels',reverse=True)
 (root/('src/ui/'+name+'-before-panels.ts')).write_text(previous)
`, [m.root]));
  const previousViewer = await m.load("ui/conversation-viewer-before-panels.ts");
  const previousWorkflow = await m.load("ui/workflow-dialog-before-panels.ts");
  const previousFleet = await m.load("ui/fleet-list-before-panels.ts");
  const host = { terminal: { columns: 120, rows: 40 }, requestRender() {} };
  const agent = { ...record(), session: { messages: [{ role: "user", content: "Literal 界 message" }], subscribe: () => () => {} } };
  const pair = [m, { ...previousViewer, ...previousWorkflow, ...previousFleet }].map(mod => {
    let fleetComponent: any;
    const fleet = new mod.FleetList({ listAgents: () => [agent] }, new Map());
    fleet.setUICtx({ setWidget(_key: string, factory: any) { if (factory) fleetComponent = factory(host, m.theme); },
      onTerminalInput: () => () => {}, getEditorText: () => "" });
    fleet.update();
    return { fleet, fleetComponent,
      viewer: new mod.ConversationViewer(host, agent.session, agent, undefined, m.theme, () => {}),
      workflow: new mod.WorkflowDialog(host, () => workflowInput(), m.theme, () => {}) };
  });
  const now = Date.now;
  try {
    const fixed = now();
    Date.now = () => fixed;
    for (const name of ["viewer", "workflow", "fleetComponent"] as const) {
      expect(pair[0][name].render(110)).toEqual(pair[1][name].render(110));
      host.terminal.rows = 12;
      const cap = name === "fleetComponent" ? 3 : 8;
      expect(pair[1][name].render(34).length).toBeGreaterThan(cap);
      expect(pair[0][name].render(34).length).toBeLessThanOrEqual(cap);
      host.terminal.rows = 40;
      expect(pair[0][name].render(110)).toEqual(pair[1][name].render(110));
    }
  } finally {
    Date.now = now;
    for (const item of pair) { item.fleet.dispose(); item.viewer.dispose(); item.workflow.dispose(); }
  }
});

realTest("native menus retain plain original labels, unique numbering and mention insertion", async () => {
  const m = await real();
  const items = [{ id: 1 }, { id: 2 }];
  expect(await m.selectItem({ select: async (_title: string, rows: string[]) => {
    expect(rows).toEqual(["1. same", "2. same"]);
    return rows[1];
  } }, "Jobs", items, () => "same")).toBe(items[1]);
  const provider = m.createMentionProvider({ getSuggestions: async () => null,
    applyCompletion: (_lines: string[], _row: number, _col: number, item: any) => item.value },
    () => [{ kind: "type", handle: "explore", type: "Explore", description: "Inspect code" }], () => true);
  const result = await provider.getSuggestions(["@ex"], 0, 3);
  expect(result.items[0].label).toBe("◇ @explore");
  expect(provider.applyCompletion([], 0, 0, result.items[0], "@ex")).toBe("@explore");
});

realTest("schedule and workflow menus keep duplicate-row identity, confirmations and inspector callbacks", async () => {
  const m = await real();
  const schedules = await m.load("ui/schedule-menu.ts");
  const workflows = await m.load("ui/workflow-menu.ts");
  const jobs = ["first", "second"].map(id => ({ id, name: "same job", schedule: "0 * * * *", scheduleType: "cron",
    subagent_type: "Explore", prompt: "keep ◆ literal", enabled: true, runCount: 2, createdAt: "2026-09-13T00:00:00Z" }));
  let removed = "";
  await schedules.showSchedulesMenu({ ui: {
    select: async (title: string, rows: string[]) => { expect(title).toContain("Scheduled jobs"); return rows[1]; },
    confirm: async (_title: string, detail: string) => { expect(detail).toContain("keep ◆ literal"); return true; },
    notify() {},
  } }, { isActive: () => true, list: () => jobs, getNextRun: () => undefined, removeJob: (id: string) => removed = id });
  expect(removed).toBe("second");
  const tasks = ["first", "second"].map((id, index) => ({ ...workflowInput().task, id, startTime: index,
    meta: { name: "Same workflow" }, workflowProgress: [], agentCount: 0 }));
  let selectedId = "";
  await workflows.showWorkflowsMenu({ ui: {
    select: async (title: string, rows: string[]) => { expect(title).toBe("Workflows"); return rows.find(row => row.endsWith("first")); },
    custom: async (factory: any) => {
      const dialog = factory({ requestRender() {} }, m.theme, {}, () => {});
      selectedId = dialog.source().task.startTime === 0 ? "first" : "second";
      within(m, dialog.render(40), 40);
      dialog.dispose();
    },
  } }, { tasks: new Map(tasks.map(task => [task.id, task])), getRecord() {}, viewAgentConversation: async () => {}, getCtx() {} });
  expect(selectedId).toBe("first");
});

realTest("Agent call/results/streaming/notifications and workflow registrations retain details, expansion and theme changes", async () => {
  const m = await real();
  const tools: any[] = [];
  const messages = new Map();
  const commands = new Map();
  const entryRenderers = new Map();
  const handlers = new Map<string, any[]>();
  const api = { registerTool: (tool: any) => tools.push(tool),
    registerMessageRenderer: (name: string, render: any) => messages.set(name, render),
    registerEntryRenderer: (name: string, render: any) => entryRenderers.set(name, render),
    registerFlag() {}, registerCommand: (name: string, command: any) => commands.set(name, command),
    on: (name: string, callback: any) => handlers.set(name, [...handlers.get(name) ?? [], callback]),
    events: { on() {}, emit() {} }, getFlag() {}, getAllTools: () => [] };
  const extension = await m.load("index.ts");
  extension.default(api);
  const tool = tools.find(tool => tool.name === "Agent");
  const workflow = tools.find(tool => tool.name === "SubagentWorkflow");
  expect(tool.renderShell).toBe("self");
  expect(workflow.renderShell).toBe("self");
  const call = tool.renderCall({ subagent_type: "Explore", description: "Inspect auth 界" }, m.theme, {});
  expect(plain(m, call.render(100))).toContain("   ◈");
  preview.push("Inline Agent", ...call.render(110));
  for (const status of ["queued", "running", "background", "completed", "steered", "aborted", "stopped", "error"]) {
    const result = { details: { status, durationMs: 1500, toolUses: 3, tokens: "320 tokens", error: "denied", agentId: "one" },
      content: [{ type: "text", text: "literal ⎿ 界 output" }] };
    for (const expanded of [false, true]) {
      const component = tool.renderResult(result, { expanded, isPartial: status === "running" }, m.theme, {});
      for (const width of [1, 4, 8, 30, 100]) within(m, component.render(width), width);
      noBackground(component.render(100));
      if (status === "completed" && expanded) expect(plain(m, component.render(100))).toContain("literal ⎿ 界 output");
      if (status === "error") expect(plain(m, component.render(100))).toContain("Error: denied");
      if (!expanded) preview.push(...component.render(110));
    }
  }
  const notification = messages.get("subagent-notification")({ details: {
    description: "Reviewed auth", status: "completed", resultPreview: "literal ⎿ preview", toolUses: 3, totalTokens: 42, durationMs: 1200,
  } }, { expanded: false, outputPad: 2 }, m.theme);
  expect(plain(m, notification.render(100))).toContain("    ✓");
  expect(plain(m, notification.render(100))).toContain("literal ⎿ preview");
  preview.push("Completion notification", ...notification.render(110));
  noBackground(notification.render(100));
  for (const width of [1, 4, 8, 30, 100]) within(m, notification.render(width), width);
  // Native composition must not add its old box/pad around renderShell:self.
  const native = await import(pathToFileURL(join(sdk!, "dist/modes/interactive/components/tool-execution.js")).href);
  const shell = new native.ToolExecutionComponent("Agent", "test", { subagent_type: "Explore", description: "native shell" },
    { showImages: false }, tool, { requestRender() {} }, temp);
  shell.updateResult({ content: [{ type: "text", text: "full literal output" }], details: { status: "completed", durationMs: 1000, toolUses: 1 } });
  shell.setExpanded(true);
  expect(plain(m, shell.render(80))).toContain("   ◈");
  expect(plain(m, shell.render(80))).toContain("full literal output");
  noBackground(shell.render(80));
  const failed = tool.renderResult({ content: [{ type: "text", text: "blocked by policy" }] },
    { expanded: false }, m.theme, { isError: true });
  expect(failed.render(100).join("\n")).toContain(m.theme.fg("error", "blocked by policy"));

  // Native /agents owns the menu chrome; settings/type-list inputs
  // remain forwarded to their original SettingsList instances.
  for (const menu of ["Agent types", "Settings"]) {
    let selected = false;
    let shown = false;
    await commands.get("agents").handler("", { cwd: temp, ui: {
      notify() {}, select: async (_title: string, rows: string[]) => {
        if (selected) return undefined;
        selected = true;
        return rows.find(row => row.startsWith(menu));
      }, custom: async (factory: any) => {
        const host = { terminal: { columns: 120, rows: 40 } };
        const component = factory(host, m.theme, {}, () => {});
        const handleInput = m.tui.SettingsList.prototype.handleInput;
        let list: any;
        m.tui.SettingsList.prototype.handleInput = function(data: string) {
          list = this;
          return handleInput.call(this, data);
        };
        try {
          component.handleInput("\x1b[B");
        } finally {
          m.tui.SettingsList.prototype.handleInput = handleInput;
        }
        expect(list).toBeDefined();
        for (let i = 0; i < list.items.length && list.selectedIndex !== list.items.length - 1; i++) {
          component.handleInput("\x1b[B");
        }
        for (const [width, rows] of [...panelSizes, ...panelSizes.toReversed()]) {
          host.terminal.columns = width;
          host.terminal.rows = rows;
          const lines = component.render(width);
          within(m, lines, width);
          expect(list.selectedIndex).toBe(list.items.length - 1);
          const cursor = m.tui.stripTerminalSequences(list.theme.cursor);
          const selectedRow = list.render(m.agentBodyWidth(width).inner)
            .find((line: string) => m.tui.stripTerminalSequences(line).startsWith(cursor));
          expect(selectedRow).toBeDefined();
          // Keep the native selected row, including its width-limited value,
          // rather than merely retaining a selection index outside the viewport.
          expect(plain(m, lines).split("\n").map(line => line.trim()))
            .toContain(m.tui.stripTerminalSequences(selectedRow).trim());
          if (width < 80 || rows < 24) {
            expect(lines.length).toBeLessThanOrEqual(rows - 4);
            expect(plain(m, lines)).toContain("Esc cancel");
          }
        }
        host.terminal.rows = 40;
        for (const width of [1, 2, 4, 8, 30, 60]) within(m, component.render(width), width);
        component.handleInput("\x1b[B");
        component.invalidate();
        within(m, component.render(30), 30);
        preview.push(menu + " menu", ...component.render(110));
        const beforeTheme = plain(m, component.render(80));
        m.colors.setThemeInstance(m.colors.loadThemeFromPath(fileURLToPath(new URL("../themes/woody.json", import.meta.url)), "truecolor"));
        component.invalidate();
        expect(plain(m, component.render(80))).toBe(beforeTheme);
        expect(component.render(80).join("\n")).not.toContain("\x1b[38;2;67;145;135m");
        m.colors.setThemeInstance(m.colors.loadThemeFromPath(fileURLToPath(new URL("../themes/osaka-jade.json", import.meta.url)), "truecolor"));
        shown = true;
        return undefined;
      },
    } });
    expect(shown).toBe(true);
  }
  const before = call.render(100).join("\n");
  const alternate = m.colors.loadThemeFromPath(fileURLToPath(new URL("../themes/woody.json", import.meta.url)), "truecolor");
  m.colors.setThemeInstance(alternate);
  call.invalidate();
  expect(call.render(100).join("\n")).not.toBe(before);
  m.colors.setThemeInstance(m.colors.loadThemeFromPath(fileURLToPath(new URL("../themes/osaka-jade.json", import.meta.url)), "truecolor"));
  // Do not run tools, session_start, or their persistence callbacks in UI tests.
  for (const callback of handlers.get("session_shutdown") ?? []) await callback({}, {});
});

realTest("agent text reuses native Text while retaining large-window output and compact gutters", async () => {
  const m = await real();
  const previousPath = join(m.root, "src/ui/agent-chrome-previous.ts");
  writeFileSync(previousPath, readFileSync(new URL("../patches/payloads/subagents/legacy/subagents_ui.ts.inc", import.meta.url), "utf8"));
  const previous = await import(pathToFileURL(previousPath).href);
  let label = "First 界 label";
  const display = () => m.colors.theme.fg("accent", label);
  const text = m.agentText(display);
  const oldText = previous.agentText(display);
  const instances = new Set();
  const render = m.tui.Text.prototype.render;
  try {
    m.tui.Text.prototype.render = function (width: number) {
      instances.add(this);
      return render.call(this, width);
    };
    for (const value of ["First 界 label", "Updated é label with wrapping"]) {
      label = value;
      for (const width of [0, 1, 2, 4, 8, 20, 80]) text.render(width);
      text.invalidate();
    }
    expect(instances.size).toBe(1);
  } finally {
    m.tui.Text.prototype.render = render;
  }
  for (const width of [0, 1, 2, 80, 120]) expect(text.render(width)).toEqual(oldText.render(width));
  for (const width of [4, 8, 20, 79]) {
    const expected = m.renderAgentBody(width, (inner: number) => new m.tui.Text(display(), 0, 0).render(inner));
    expect(text.render(width)).toEqual(expected);
  }
});
