import { afterAll, expect, mock } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { checkProcess as check, copySdk, describePatch, patchModule, temporaryDirectory } from "./support/patch_fixtures";
import { nativeSuite } from "./support/native_suite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const patcher = fileURLToPath(new URL("../patches/pi_extension_dialogs.py", import.meta.url));
const sdk = process.env.PI_SDK_ROOT;
const { child, unitTest: test, nativeTest: realTest } = nativeSuite(import.meta.path, !!sdk);
const temp = temporaryDirectory("pi-extension-dialogs-test-");
// Compact edits also match code emitted by the base edits. Build guard inputs
// from the original anchors, not those intermediate replacement strings.
const { edits, module: modulePath, marker } = describePatch<{
  edits: Record<string, [string, string, number][]>; module: string; marker: string;
}>(patcher, "{'edits':m['LEGACY_EDITS'],'module':m['MODULE'],'marker':m['MARKER']}");
const files = Object.keys(edits);
const run = (root: string) => Bun.spawnSync(["python3", "-B", patcher], { env: { ...process.env, PI_SDK_ROOT: root, HOME: root } });
function sandbox(name: string) {
  const root = join(temp, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), '{"version":"0.87.1","type":"module"}');
  for (const [file, replacements] of Object.entries(edits)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), replacements.flatMap(([old, , count]) => Array(count).fill(old)).join("\n") + "\n        super();\n// unrelated source edit\n");
  }
  return root;
}
function contents(root: string) {
  return Object.fromEntries([...files, modulePath].map(file => [file,
    existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : null]));
}

test("both complete previous layouts migrate with exact backups; mixed or modified layouts refuse", () => {
  for (const legacyFile of ["extension_dialogs.js.inc", "extension_dialogs_before_compact.js.inc"]) {
    const root = sandbox(`previous-${legacyFile}`);
    const originals = contents(root);
    const legacy = readFileSync(new URL(`../patches/payloads/host/legacy/${legacyFile}`, import.meta.url), "utf8");
    // Construct the complete former source contract, not a new layout with an
    // old helper: constructors and helper must migrate together.
    for (const [file, replacements] of Object.entries(edits)) {
      let source = originals[file]!;
      for (const [old, replacement] of replacements) source = source.replaceAll(old, replacement);
      writeFileSync(join(root, file), "// configs:pi-extension-dialogs-v1\n" + source);
    }
    writeFileSync(join(root, modulePath), legacy);
    const previous = contents(root);
    check(run(root));
    const current = contents(root);
    const backups = join(root, ".config/theme-backups");
    const backup = readdirSync(backups);
    expect(backup).toHaveLength(1);
    for (const file of [...files, modulePath]) {
      expect(readFileSync(join(backups, backup[0], file), "utf8")).toBe(previous[file]!);
    }
    expect(JSON.parse(readFileSync(join(backups, backup[0], "added-files.json"), "utf8"))).toEqual([]);
    check(run(root));
    expect(contents(root)).toEqual(current);
    expect(readdirSync(backups)).toEqual(backup);

    for (const mode of ["mixed-helper", "mixed-component", "modified-helper", "modified-constructor"]) {
      for (const [file, source] of Object.entries(previous)) writeFileSync(join(root, file), source!);
      if (mode === "mixed-helper") writeFileSync(join(root, modulePath), current[modulePath]!);
      if (mode === "mixed-component") writeFileSync(join(root, files[0]), current[files[0]]!);
      if (mode === "modified-helper") writeFileSync(join(root, modulePath), legacy + "\n// local helper edit");
      if (mode === "modified-constructor") writeFileSync(join(root, files[0]), previous[files[0]]!.replace("super();", "super(custom);"));
      const before = contents(root);
      expect(run(root).exitCode).not.toBe(0);
      expect(contents(root)).toEqual(before);
      expect(readdirSync(backups)).toEqual(backup);
    }
  }
});

test("native dialog patch validates every source, backs up exact originals and repeats without writing", () => {
  const root = sandbox("valid");
  const before = contents(root);
  check(run(root));
  const after = contents(root);
  const backupRoot = join(root, ".config/theme-backups");
  const backups = readdirSync(backupRoot);
  expect(backups).toHaveLength(1);
  for (const file of files) {
    expect(readFileSync(join(backupRoot, backups[0], file), "utf8")).toBe(before[file]!);
    expect(after[file]).toContain("// unrelated source edit");
  }
  expect(JSON.parse(readFileSync(join(backupRoot, backups[0], "added-files.json"), "utf8"))).toEqual([modulePath]);
  check(run(root));
  expect(contents(root)).toEqual(after);
  expect(readdirSync(backupRoot)).toEqual(backups);
});

test("partial, incompatible, duplicate and changed-helper installations refuse all writes", () => {
  for (const mode of ["version", "changed", "duplicate", "partial", "missing-helper", "changed-helper", "unexpected-helper", "residual-original", "moved-marker"]) {
    const root = sandbox(mode);
    const target = join(root, files.at(-1)!);
    const original = readFileSync(target, "utf8");
    if (mode === "version") writeFileSync(join(root, "package.json"), '{"version":"0.85.0"}');
    else if (mode === "changed") writeFileSync(target, original.replace("extends Container", "extends OtherContainer"));
    else if (mode === "duplicate") writeFileSync(target, original + "extends Container {");
    else if (mode === "unexpected-helper") writeFileSync(join(root, modulePath), "unrelated file");
    else {
      check(run(root));
      if (mode === "partial") writeFileSync(target, original);
      else if (mode === "missing-helper") rmSync(join(root, modulePath));
      else if (mode === "changed-helper") writeFileSync(join(root, modulePath), "changed helper");
      else if (mode === "moved-marker") writeFileSync(target, readFileSync(target, "utf8").replace(marker + "\n", "") + marker);
      else writeFileSync(target, readFileSync(target, "utf8") + "extends Container {");
    }
    const before = contents(root);
    expect(run(root).exitCode).not.toBe(0);
    expect(contents(root)).toEqual(before);
  }
  const absent = join(temp, "absent");
  check(run(absent));
  expect(existsSync(absent)).toBe(false);
});

const fixture = join(temp, "sdk");
let loaded: Promise<any> | undefined;
let externalResult: { status: string; content?: string } | Error = { status: "complete", content: "edited outside" };
const externalCalls: any[] = [];
function real() {
  return loaded ??= (async () => {
    copySdk(sdk!, fixture);
    // Work on original fixtures whether the live host is original or patched.
    const normalize = patchModule(patcher, `
root=pathlib.Path(sys.argv[2])
s={n:(root/n).read_text() for n in m['EDITS']}
if (root/m['MODULE']).exists(): s[m['MODULE']]=(root/m['MODULE']).read_text()
s=m['patch_sources'](s)
if all(s[n].startswith(m['MARKER']) for n in m['EDITS']):
 for n in m['EDITS']: (root/n).write_text(m['transform'](n,s[n].removeprefix(m['MARKER']+'\\n'),True))
 (root/m['MODULE']).unlink(missing_ok=True)
`, [fixture]);
    check(normalize);
    const originals = contents(fixture);
    check(run(fixture));
    // Only external process launching is replaced; native component methods,
    // input, editor, TUI text rendering, theme and countdown are real.
    mock.module(join(fixture, "dist/modes/interactive/external-editor.js"), () => ({
      editInExternalEditor: async (options: any) => {
        externalCalls.push(options);
        if (externalResult instanceof Error) throw externalResult;
        return externalResult;
      },
    }));
    const load = (file: string) => import(pathToFileURL(join(fixture, "dist/modes/interactive", file)).href);
    const tui = await import(pathToFileURL(join(fixture, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);
    const { KEYBINDINGS } = await import(pathToFileURL(join(fixture, "dist/core/keybindings.js")).href);
    tui.setKeybindings(new tui.KeybindingsManager(KEYBINDINGS));
    const colors = await load("theme/theme.js");
    colors.setThemeInstance(colors.loadThemeFromPath(fileURLToPath(new URL("../themes/osaka-jade.json", import.meta.url)), "truecolor"));
    return { originals, tui, colors,
      ...await load("components/extension-selector.js"), ...await load("components/extension-input.js"),
      ...await load("components/extension-editor.js"), ...await load("interactive-mode.js"),
    };
  })();
}
const preview: string[] = [];
afterAll(() => {
  if (child && process.env.PI_DIALOGS_PREVIEW && preview.length) writeFileSync(process.env.PI_DIALOGS_PREVIEW, preview.join("\n") + "\n");
});
const plain = (m: any, lines: string[]) => lines.map(m.tui.stripTerminalSequences).join("\n");
function bounded(m: any, component: any, width: number, cursor = false) {
  const lines = component.render(width);
  for (const line of lines) expect(m.tui.visibleWidth(line)).toBeLessThanOrEqual(width);
  if (cursor) {
    const marked = lines.filter((line: string) => line.includes(m.tui.CURSOR_MARKER));
    expect(marked).toHaveLength(1);
    const column = m.tui.visibleWidth(marked[0].split(m.tui.CURSOR_MARKER)[0]);
    expect(column).toBeLessThan(width);
  }
  return lines;
}
const widths = [1, 2, 4, 8, 20, 80];
const hostTui = () => ({ terminal: { rows: 30, columns: 200 }, requestRender() {}, stop() {}, start() {} });

realTest("selector/confirm chrome is inset and width-safe while original options and controls survive", async () => {
  const m = await real();
  const selected: string[] = [];
  let cancelled = 0;
  let expanded = 0;
  const options = ["First ◆ literal 界", "Second", "Yes", "No"];
  const selector = new m.ExtensionSelectorComponent("Agents 界", options, (value: string) => selected.push(value), () => cancelled++,
    { onToggleToolsExpanded: () => expanded++ });
  for (const width of widths) bounded(m, selector, width);
  const lines = selector.render(80);
  expect(plain(m, lines)).toContain("   ╭");
  expect(plain(m, lines)).toContain("   ◈ Agents 界");
  expect(plain(m, lines)).toContain("   ◆ First ◆ literal 界");
  expect(plain(m, lines)).toContain("   ◇ Second");
  expect(plain(m, lines)).not.toContain("→ ");
  selector.handleInput("j");
  selector.handleInput("\n");
  expect(selected).toEqual(["Second"]);
  selector.handleInput("k");
  selector.handleInput("\n");
  expect(selected.at(-1)).toBe(options[0]);
  selector.handleInput("\x0f");
  expect(expanded).toBe(1);
  selector.handleInput("\x1b");
  expect(cancelled).toBe(1);
  preview.push("Native selector", ...lines);
  // The host's actual confirm adapter delegates to this selector and maps Yes/No.
  let offered: string[] | undefined;
  const confirmHost = { showExtensionSelector: async (_title: string, values: string[]) => { offered = values; return "Yes"; } };
  expect(await m.InteractiveMode.prototype.showExtensionConfirm.call(confirmHost, "Delete?", "Keep ◆ detail")).toBe(true);
  expect(offered).toEqual(["Yes", "No"]);
  confirmHost.showExtensionSelector = async () => "No";
  expect(await m.InteractiveMode.prototype.showExtensionConfirm.call(confirmHost, "Delete?", "detail")).toBe(false);
  selector.dispose();
});

realTest("single-line input keeps editing, focus, paste and IME markers through tiny widths", async () => {
  const m = await real();
  let submitted = "";
  let cancelled = 0;
  const input = new m.ExtensionInputComponent("Agent name", "", (value: string) => submitted = value, () => cancelled++);
  input.focused = true;
  expect(input.input.focused).toBe(true);
  input.handleInput("\x1b[200~界🧪 literal ◆\x1b[201~");
  const value = input.input.getValue();
  for (const width of widths) bounded(m, input, width, true);
  expect(input.input.getValue()).toBe(value);
  input.invalidate();
  input.handleInput("\n");
  expect(submitted).toBe(value);
  input.handleInput("\x1b");
  expect(cancelled).toBe(1);
  input.focused = false;
  expect(input.render(80).join("\n")).not.toContain(m.tui.CURSOR_MARKER);
  preview.push("Native input", ...input.render(80));
  input.dispose();
});

realTest("multiline editor preserves wrapping, text, focus and external-editor callbacks", async () => {
  const m = await real();
  const events: string[] = [];
  const tui = { ...hostTui(), terminal: { rows: 12, columns: 40 },
    stop: () => events.push("stop"), start: () => events.push("start"),
    requestRender: (force?: boolean) => events.push(force ? "render-force" : "render") };
  let submitted = "";
  let cancelled = 0;
  const editor = new m.ExtensionEditorComponent(tui, { matches: (data: string, key: string) => data === "external" && key === "app.editor.external" },
    "System prompt", "first 界\nsecond ◆\nthird", (value: string) => submitted = value, () => cancelled++, {}, "test-editor");
  editor.focused = true;
  expect(editor.editor.focused).toBe(true);
  for (const width of widths) bounded(m, editor, width, true);
  const text = editor.editor.getText();
  editor.invalidate();
  expect(editor.editor.getText()).toBe(text);
  preview.push("Native editor", ...editor.render(80));
  // Native keyboard input still owns edits and multiline/paste interpretation.
  editor.handleInput("\x1b[200~ added\nline\x1b[201~");
  expect(editor.editor.getText()).toContain("added");
  editor.editor.onSubmit(editor.editor.getText());
  expect(submitted).toContain("added");
  editor.handleInput("\x1b");
  expect(cancelled).toBe(1);
  const beforeExternal = editor.editor.getText();
  await editor.handleOpenExternalEditor();
  expect(externalCalls.at(-1)).toEqual({ command: "test-editor", content: beforeExternal });
  expect(editor.editor.getText()).toBe("edited outside");
  expect(events.slice(-3)).toEqual(["stop", "start", "render-force"]);
  externalResult = { status: "cancelled" };
  await editor.handleOpenExternalEditor();
  expect(editor.editor.getText()).toBe("edited outside");
  externalResult = new Error("external editor failed");
  await expect(editor.handleOpenExternalEditor()).rejects.toThrow("external editor failed");
  expect(events.slice(-3)).toEqual(["stop", "start", "render-force"]);
  externalResult = { status: "complete", content: "edited outside" };
  let externalKey = false;
  editor.handleOpenExternalEditor = async () => { externalKey = true; };
  editor.handleInput("external");
  expect(externalKey).toBe(true);
});

realTest("live theme refresh recolors titles/options/hints without resetting selection, input or countdown", async () => {
  const m = await real();
  let cancelled = 0;
  const tui = { ...hostTui(), terminal: { rows: 12, columns: 40 } };
  const selector = new m.ExtensionSelectorComponent("Choose", ["first", "second"], () => {}, () => cancelled++,
    { timeout: 60_000, tui });
  const input = new m.ExtensionInputComponent("Type", "", () => {}, () => cancelled++, { timeout: 60_000, tui });
  const editor = new m.ExtensionEditorComponent(tui, { matches: () => false }, "Edit", "kept 界", () => {}, () => {});
  selector.handleInput("j");
  input.handleInput("unchanged 界");
  // Drive the real countdown's display callbacks, without waiting for wall time.
  selector.countdown.onTick(17);
  input.countdown.onTick(13);
  const before = [selector.render(40), input.render(40), editor.render(40)];
  const timers = [selector.countdown, input.countdown];
  const value = input.input.getValue();
  m.colors.setThemeInstance(m.colors.loadThemeFromPath(fileURLToPath(new URL("../themes/woody.json", import.meta.url)), "truecolor"));
  selector.invalidate();
  input.invalidate();
  editor.invalidate();
  const after = [selector.render(40), input.render(40), editor.render(40)];
  expect(editor.editor.getText()).toBe("kept 界");
  expect(selector.selectedIndex).toBe(1);
  expect(input.input.getValue()).toBe(value);
  expect(selector.countdown).toBe(timers[0]);
  expect(input.countdown).toBe(timers[1]);
  expect(plain(m, after[0])).toContain("Choose (17s)");
  expect(plain(m, after[1])).toContain("Type (13s)");
  for (let i = 0; i < 3; i++) {
    expect(plain(m, before[i])).toBe(plain(m, after[i]));
    expect(before[i].join("\n")).not.toBe(after[i].join("\n"));
    expect(after[i].join("\n")).not.toContain("\x1b[38;2;67;145;135m");
  }
  selector.countdown.onExpire();
  input.countdown.onExpire();
  expect(cancelled).toBe(2);
  selector.dispose();
  input.dispose();
  m.colors.setThemeInstance(m.colors.loadThemeFromPath(fileURLToPath(new URL("../themes/osaka-jade.json", import.meta.url)), "truecolor"));
});

realTest("compact dialogs keep controls and native selection/carets visible while resizing", async () => {
  const m = await real();
  const tui = hostTui();
  const options = Array.from({ length: 35 }, (_, i) => `Option ${i} 界 ${"long label ".repeat(6)}`);
  const selected: string[] = [];
  const selector = new m.ExtensionSelectorComponent("Choose agent", options,
    (value: string) => selected.push(value), () => {}, { tui });
  const input = new m.ExtensionInputComponent("Agent name", "", () => {}, () => {}, { tui });
  const editor = new m.ExtensionEditorComponent(tui, { matches: () => false }, "System prompt",
    Array.from({ length: 25 }, (_, i) => `line ${i} 界`).join("\n"), () => {}, () => {});
  input.focused = true;
  editor.focused = true;
  input.handleInput("\x1b[200~input 界🧪\x1b[201~");
  for (let i = 1; i < options.length; i++) selector.handleInput("j");

  const sizes = [[120, 40], [40, 12], [50, 16], [60, 20], [120, 12], [40, 40], [120, 40], [40, 12]];
  for (const [columns, rows] of sizes) {
    tui.terminal.rows = rows;
    tui.terminal.columns = columns;
    // The shared host inset has already consumed these columns before render.
    const width = columns - 2 * Math.max(1, Math.floor(columns * 0.02));
    for (const [component, title, caret] of [[selector, "Choose agent", false], [input, "Agent name", true], [editor, "System prompt", true]] as const) {
      const lines = bounded(m, component, width, caret);
      expect(lines.length).toBeLessThanOrEqual(rows - 2);
      expect(plain(m, lines)).toContain(title);
      expect(plain(m, lines)).toContain("cancel");
      expect(plain(m, lines)).toContain(component === selector ? "select" : "submit");
      if (rows < 24) expect(lines.every((line: string) => m.tui.visibleWidth(line.trim()) > 0)).toBe(true);
    }
    expect(plain(m, selector.render(width))).toContain("◆ Option 34");
    expect(selector.selectedIndex).toBe(34);
    expect(input.input.getValue()).toBe("input 界🧪");
    // Use the actual editor's navigation and scroll offset, not a test caret.
    for (const key of ["\x1b[A", "\x1b[A", "\x1b[B"]) editor.handleInput(key);
    bounded(m, editor, width, true);
    if (rows < 24) {
      const editorRows = editor.render(width);
      expect(editorRows.length).toBeLessThanOrEqual(Math.max(5, Math.floor(rows * 0.3)) + 2);
      expect(plain(m, editorRows)).toContain("newline");
      expect(plain(m, editorRows)).toContain("editor");
    }
  }
  selector.handleInput("\n");
  expect(selected).toEqual([options[34]]);
  for (let i = 34; i > 0; i--) selector.handleInput("k");
  expect(plain(m, selector.render(40))).toContain("◆ Option 0");
  selector.handleInput("\n");
  expect(selected.at(-1)).toBe(options[0]);
  selector.dispose();
  input.dispose();
});

realTest("full-size dialog output remains byte-identical to the previous layout", async () => {
  const m = await real();
  const componentDirectory = dirname(join(fixture, modulePath));
  writeFileSync(join(componentDirectory, "extension-dialogs-baseline.js"),
    readFileSync(new URL("../patches/payloads/host/legacy/extension_dialogs_before_compact.js.inc", import.meta.url), "utf8"));
  const baseline: any = {};
  for (const [file, replacements] of Object.entries(edits)) {
    let source = m.originals[file];
    for (const [old, replacement] of replacements) source = source.replaceAll(old, replacement);
    source = source.replace('"./extension-dialogs.js"', '"./extension-dialogs-baseline.js"');
    const path = join(fixture, file.replace(".js", "-baseline.js"));
    writeFileSync(path, source);
    Object.assign(baseline, await import(pathToFileURL(path).href));
  }
  const tui = { ...hostTui(), terminal: { rows: 40, columns: 120 } };
  const create = (owner: any) => [
    new owner.ExtensionSelectorComponent("Pick agent 界", ["first", "second ◆", "third"], () => {}, () => {}, { tui }),
    new owner.ExtensionInputComponent("Name 界", "", () => {}, () => {}, { tui }),
    new owner.ExtensionEditorComponent(tui, { matches: () => false }, "Edit 界", "first\nsecond", () => {}, () => {}),
  ];
  const current = create(m);
  const previous = create(baseline);
  for (let i = 0; i < current.length; i++) {
    current[i].focused = true;
    previous[i].focused = true;
    for (const width of [80, 120]) expect(current[i].render(width)).toEqual(previous[i].render(width));
    current[i].dispose?.();
    previous[i].dispose?.();
  }
});

realTest("native renderer switches retain live dialog sizing and the short dock's controls", async () => {
  const m = await real();
  const { renderLayoutFrame } = await import(pathToFileURL(join(fixture, "node_modules/@earendil-works/pi-tui/dist/layout.js")).href);
  let renderer = m.createInteractiveTui({ tuiMode: "regular", terminal: {
    columns: 40, rows: 12, write() {}, hideCursor() {}, showCursor() {}, stop() {},
  } });
  renderer.requestRender = () => {};
  const tui = m.createInteractiveTuiReference(() => renderer);
  const selector = new m.ExtensionSelectorComponent("Choose", Array.from({ length: 30 }, (_, i) => `choice ${i}`),
    () => {}, () => {}, { tui });
  const input = new m.ExtensionInputComponent("Name", "", () => {}, () => {}, { tui });
  const editor = new m.ExtensionEditorComponent(tui, { matches: () => false }, "Edit", "a\nb\nc\nd\ne\nf\ng", () => {}, () => {});
  input.focused = true;
  editor.focused = true;
  for (let i = 0; i < 29; i++) selector.handleInput("j");
  for (const mode of ["regular", "fullscreen", "regular"]) {
    const terminal = { columns: 40, rows: 12, write() {}, hideCursor() {}, showCursor() {}, stop() {} };
    renderer = m.createInteractiveTui({ tuiMode: mode, terminal });
    renderer.requestRender = () => {};
    for (const component of [selector, input, editor]) {
      const dock = new m.tui.VStack([
        { component: new m.tui.Text("Todos\nAgents", 0, 0), shrink: 1 },
        { component, shrink: 1, minSize: 3 },
        { component: new m.tui.Text("model", 0, 0), shrink: 1 },
      ]);
      const root = new m.tui.VStack([
        { component: new m.tui.ScrollView(new m.tui.Text("Conversation", 0, 0)), basis: 0, grow: 1, minSize: 1 },
        { component: dock, shrink: 1, minSize: 1 },
      ]);
      const lines = mode === "fullscreen" ? renderLayoutFrame(root, 38, 12, () => {}).lines : root.render(38).slice(-12);
      const output = plain(m, lines);
      for (const label of ["Todos", "Agents", "model", "cancel"]) expect(output).toContain(label);
      expect(output).toContain(component === selector ? "select" : "submit");
      expect(output).toContain(component === selector ? "Choose" : component === input ? "Name" : "Edit");
      if (component !== selector) expect(lines.join("\n")).toContain(m.tui.CURSOR_MARKER);
    }
    terminal.rows = 40;
    expect(selector.render(120).length).toBeGreaterThan(7);
    terminal.rows = 12;
    expect(selector.render(40).length).toBeLessThanOrEqual(7);
  }
  selector.dispose();
  input.dispose();
});

realTest("dialog text reuses its native wrapper without changing previous rendered bytes", async () => {
  const m = await real();
  const current = await import(pathToFileURL(join(fixture, modulePath)).href);
  const previousPath = join(fixture, "dist/modes/interactive/components/extension-dialogs-previous.js");
  writeFileSync(previousPath, readFileSync(new URL("../patches/payloads/host/legacy/extension_dialogs.js.inc", import.meta.url), "utf8"));
  const previous = await import(pathToFileURL(previousPath).href);
  let label = "First 界 title";
  const display = () => m.colors.theme.fg("accent", label);
  const text = new current.DialogText(display);
  const oldText = new previous.DialogText(display);
  const content = text.content;
  for (const value of ["First 界 title", "Updated é label with wrapping"]) {
    label = value;
    for (const width of [1, 2, 4, 8, 20, 80]) expect(text.render(width)).toEqual(oldText.render(width));
    text.invalidate();
    expect(text.content).toBe(content);
  }
});
