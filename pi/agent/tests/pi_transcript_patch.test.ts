import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { applySdkPatches, copySdk, describePatch, temporaryDirectory } from "./support/patch_fixtures";
import { nativeSuite } from "./support/native_suite";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const patcher = fileURLToPath(new URL("../patches/pi_transcript.py", import.meta.url));
const { edits, module: modulePath } = describePatch<{ edits: Record<string, [string, string][]>; module: string }>(
  patcher, "{'edits':m['EDITS'],'module':m['MODULE']}");
const previousLookup = describePatch<[string, string]>(patcher, "m['PRE_INTERCOM_LOOKUP']");
const previousSourceReadLookup = describePatch<[string, string]>(patcher, "m['PRE_SOURCE_READ_LOOKUP']");
const previousUniversalLookup = describePatch<[string, string]>(patcher, "m['PRE_UNIVERSAL_TOOLS_LOOKUP']");
const previousBackground = describePatch<string>(patcher, "m['PRE_USER_BACKGROUND_MODULE_SOURCE']");
const previousBackgroundReset = describePatch<string>(patcher, "m['PRE_USER_BACKGROUND_RESET_MODULE_SOURCE']");
const temp = temporaryDirectory("pi-transcript-");
const sdk = process.env.PI_SDK_ROOT;
const { unitTest: test, nativeTest: realTest } = nativeSuite(import.meta.path, !!sdk, { FORCE_COLOR: "1" });
const run = (root: string) => Bun.spawnSync(["python3", "-B", patcher], { env: { ...process.env, PI_SDK_ROOT: root, HOME: root } });

function sandbox(name: string) {
  const root = join(temp, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), '{"version":"0.87.1","type":"module"}');
  for (const [file, changes] of Object.entries(edits)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), changes.map(([old]) => old).join("\n") + "\n// unrelated edit\n");
  }
  return root;
}

function contents(root: string) {
  return Object.fromEntries([...Object.keys(edits), modulePath].map(file => [file,
    existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : null]));
}

test("complete previous revisions migrate together with exact backups; mixed revisions refuse", () => {
  const legacyEdits = JSON.parse(readFileSync(new URL("../patches/payloads/host/legacy/transcript_edits_v1.json", import.meta.url), "utf8")) as typeof edits;
  const preMetricsEdits = JSON.parse(readFileSync(new URL("../patches/payloads/host/legacy/transcript_edits_before_metrics.json", import.meta.url), "utf8")) as typeof edits;
  const revisions = [
    { changes: legacyEdits, helper: "transcript.js.inc" },
    { changes: legacyEdits, helper: "transcript_before_compact.js.inc" },
    { changes: preMetricsEdits, helper: "transcript_before_yellow_icon.js.inc" },
    { changes: preMetricsEdits, helper: "transcript_before_metrics.js.inc" },
  ];
  for (const { changes, helper } of revisions) {
    // Historical layouts still require the current host's built-in renderer lookup.
    changes["dist/modes/interactive/interactive-mode.js"][2] = edits["dist/modes/interactive/interactive-mode.js"][2];
    const root = sandbox(helper);
    for (const [file, changesForFile] of Object.entries(changes)) {
      let source = readFileSync(join(root, file), "utf8");
      for (const [old, patched] of changesForFile) source = source.replace(old, patched);
      writeFileSync(join(root, file), source);
    }
    const legacy = readFileSync(new URL(`../patches/payloads/host/legacy/${helper}`, import.meta.url), "utf8");
    writeFileSync(join(root, modulePath), legacy);
    // A recognizable old helper must not authorize a partially applied producer patch.
    const producer = "dist/core/tools/read.js";
    const source = readFileSync(join(root, producer), "utf8");
    writeFileSync(join(root, producer), source.replace(...edits[producer][0]));
    const mixed = contents(root);
    expect(run(root).exitCode).not.toBe(0);
    expect(contents(root)).toEqual(mixed);
    expect(existsSync(join(root, ".config/theme-backups"))).toBe(false);
    writeFileSync(join(root, producer), source);

    const before = contents(root);
    expect(run(root).exitCode).toBe(0);
    const backups = join(root, ".config/theme-backups");
    const names = readdirSync(backups);
    expect(names).toHaveLength(1);
    for (const [file, source] of Object.entries(before)) {
      expect(readFileSync(join(backups, names[0], file), "utf8")).toBe(source!);
    }
    expect(JSON.parse(readFileSync(join(backups, names[0], "added-files.json"), "utf8"))).toEqual([]);
    const after = contents(root);
    expect(run(root).exitCode).toBe(0);
    expect(contents(root)).toEqual(after);
    expect(readdirSync(backups)).toEqual(names);

    // A known old helper is not compatible with the new host imports by itself.
    for (const source of [legacy, legacy + "\n// local helper edit"]) {
      writeFileSync(join(root, modulePath), source);
      expect(run(root).exitCode).not.toBe(0);
      expect(readFileSync(join(root, modulePath), "utf8")).toBe(source);
      expect(readdirSync(backups)).toEqual(names);
    }
  }
});

for (const helper of [
  "transcript_before_tool_rows.js.inc",
  "transcript_before_native_padding.js.inc",
  "transcript_before_inline_metrics.js.inc",
  "transcript_before_user_separator.js.inc",
  "transcript_before_separator_padding.js.inc",
  "transcript_before_source_read.js.inc",
  "transcript_before_single_action.js.inc",
  "transcript_before_single_action_dash_removal.js.inc",
  "transcript_before_universal_tools.js.inc",
  "transcript_before_intercom_label.js.inc",
  "transcript_before_chat_icon.js.inc",
  "transcript_before_row_cache.js.inc",
]) {
  test(`${helper} upgrades alone and refuses mixed or modified sources`, () => {
    const previous = readFileSync(new URL(`../patches/payloads/host/legacy/${helper}`, import.meta.url), "utf8");
    const root = sandbox(helper);
    expect(run(root).exitCode).toBe(0);
    const current = contents(root);
    writeFileSync(join(root, modulePath), previous);
    const backupRoot = join(root, ".config/theme-backups");
    const originalBackups = readdirSync(backupRoot);

    expect(run(root).exitCode).toBe(0);
    expect(contents(root)).toEqual(current);
    const backups = readdirSync(backupRoot);
    const added = backups.filter(name => !originalBackups.includes(name));
    expect(added).toHaveLength(1);
    expect(readFileSync(join(backupRoot, added[0], modulePath), "utf8")).toBe(previous);
    expect(JSON.parse(readFileSync(join(backupRoot, added[0], "added-files.json"), "utf8"))).toEqual([]);
    expect(run(root).exitCode).toBe(0);
    expect(contents(root)).toEqual(current);
    expect(readdirSync(backupRoot)).toEqual(backups);

    for (const state of ["modified-helper", "partial-producer"]) {
      const invalid = sandbox(`${helper}-${state}`);
      expect(run(invalid).exitCode).toBe(0);
      writeFileSync(join(invalid, modulePath), previous + (state === "modified-helper" ? "\n// local edit" : ""));
      if (state === "partial-producer") {
        const file = "dist/core/tools/read.js";
        const [old, patched] = edits[file][0];
        writeFileSync(join(invalid, file), readFileSync(join(invalid, file), "utf8").replace(patched, old));
      }
      const before = contents(invalid);
      expect(run(invalid).exitCode).not.toBe(0);
      expect(contents(invalid)).toEqual(before);
      expect(readdirSync(join(invalid, ".config/theme-backups"))).toHaveLength(1);
    }
  });
}

test("the pre-cache host and helper migrate together with exact backups", () => {
  const previousEdits = describePatch<typeof edits>(patcher, "m['PRE_ROW_CACHE_EDITS']");
  const root = sandbox("pre-row-cache");
  for (const [file, changes] of Object.entries(previousEdits)) {
    let source = readFileSync(join(root, file), "utf8");
    for (const [old, patched] of changes) source = source.replace(old, patched);
    writeFileSync(join(root, file), source);
  }
  const previousHelper = readFileSync(new URL("../patches/payloads/host/legacy/transcript_before_row_cache.js.inc", import.meta.url), "utf8");
  const currentHelper = readFileSync(new URL("../patches/payloads/host/transcript.js.inc", import.meta.url), "utf8");
  // The new helper must not silently run without the native invalidation hook.
  for (const invalidHelper of [currentHelper, previousHelper + "\n// local edit"]) {
    writeFileSync(join(root, modulePath), invalidHelper);
    const before = contents(root);
    expect(run(root).exitCode).not.toBe(0);
    expect(contents(root)).toEqual(before);
    expect(existsSync(join(root, ".config/theme-backups"))).toBe(false);
  }
  writeFileSync(join(root, modulePath), previousHelper);
  const before = contents(root);
  expect(run(root).exitCode).toBe(0);
  expect(contents(root)[modulePath]).toBe(currentHelper);
  const toolFile = "dist/modes/interactive/components/tool-execution.js";
  expect(contents(root)[toolFile]).toContain(edits[toolFile][1][1]);
  const backupRoot = join(root, ".config/theme-backups");
  const backups = readdirSync(backupRoot);
  expect(backups).toHaveLength(1);
  for (const [file, source] of Object.entries(before)) {
    expect(readFileSync(join(backupRoot, backups[0], file), "utf8")).toBe(source!);
  }
  const after = contents(root);
  expect(run(root).exitCode).toBe(0);
  expect(contents(root)).toEqual(after);
  expect(readdirSync(backupRoot)).toEqual(backups);
});

for (const [name, lookup, previousHelper] of [
  ["pre-Intercom", previousLookup, undefined],
  ["pre-source-read", previousSourceReadLookup, readFileSync(new URL(
    "../patches/payloads/host/legacy/transcript_before_source_read.js.inc", import.meta.url), "utf8")],
  ["pre-universal-tools", previousUniversalLookup, readFileSync(new URL(
    "../patches/payloads/host/legacy/transcript_before_universal_tools.js.inc", import.meta.url), "utf8")],
] as const) {
  test(`the installed ${name} lookup migrates with exact helper guards and backups`, () => {
    const root = sandbox(name);
    expect(run(root).exitCode).toBe(0);
    const current = contents(root);
    const file = "dist/modes/interactive/interactive-mode.js";
    const previous = current[file]!.replace(edits[file][2][1], lookup[1]);
    writeFileSync(join(root, file), previous);
    const backupRoot = join(root, ".config/theme-backups");
    const beforeBackups = readdirSync(backupRoot);
    const helper = previousHelper ?? current[modulePath]!;
    writeFileSync(join(root, modulePath), helper + "\n// changed helper");
    const invalid = contents(root);
    expect(run(root).exitCode).not.toBe(0);
    expect(contents(root)).toEqual(invalid);
    expect(readdirSync(backupRoot)).toEqual(beforeBackups);
    writeFileSync(join(root, modulePath), helper);
    expect(run(root).exitCode).toBe(0);
    expect(contents(root)).toEqual(current);
    const backup = readdirSync(backupRoot).find(name => !beforeBackups.includes(name))!;
    expect(readFileSync(join(backupRoot, backup, file), "utf8")).toBe(previous);
    expect(readFileSync(join(backupRoot, backup, modulePath), "utf8")).toBe(helper);
    expect(run(root).exitCode).toBe(0);
    expect(readdirSync(backupRoot)).toHaveLength(2);
  });
}

for (const [name, previous] of [["simple-background", previousBackground], ["reset-background", previousBackgroundReset]] as const) {
  test(`installed ${name} migrates to native user styling`, () => {
    const root = sandbox(`remove-${name}`);
    expect(run(root).exitCode).toBe(0);
    const current = contents(root);
    writeFileSync(join(root, modulePath), previous);
    const backupRoot = join(root, ".config/theme-backups");
    const beforeBackups = readdirSync(backupRoot);

    expect(run(root).exitCode).toBe(0);
    expect(contents(root)).toEqual(current);
    const added = readdirSync(backupRoot).filter(name => !beforeBackups.includes(name));
    expect(added).toHaveLength(1);
    expect(readFileSync(join(backupRoot, added[0], modulePath), "utf8")).toBe(previous);
  });
}

test("transcript patch validates, backs up exact originals, and repeats without writes", () => {
  const root = sandbox("valid");
  const before = contents(root);
  expect(run(root).exitCode).toBe(0);
  const after = contents(root);
  const backupRoot = join(root, ".config/theme-backups");
  const backups = readdirSync(backupRoot);
  expect(backups).toHaveLength(1);
  for (const file of Object.keys(edits)) {
    expect(readFileSync(join(backupRoot, backups[0], file), "utf8")).toBe(before[file]!);
    expect(after[file]).toContain("// unrelated edit");
  }
  expect(JSON.parse(readFileSync(join(backupRoot, backups[0], "added-files.json"), "utf8"))).toEqual([modulePath]);
  expect(run(root).exitCode).toBe(0);
  expect(contents(root)).toEqual(after);
  expect(readdirSync(backupRoot)).toEqual(backups);
});

test("partial hosts, changed modules, duplicate anchors and wrong versions refuse all writes", () => {
  const last = Object.keys(edits).at(-1)!;
  for (const state of ["partial", "duplicate", "version", "missing-module", "changed-module", "unexpected-module", "residual-original", "old-tool-lookup"]) {
    const root = sandbox(state);
    if (state === "version") writeFileSync(join(root, "package.json"), '{"version":"0.85.0"}');
    else if (state === "partial") writeFileSync(join(root, last), edits[last][0][1]);
    else if (state === "duplicate") writeFileSync(join(root, last), edits[last][0][0].repeat(2));
    else if (state === "unexpected-module") writeFileSync(join(root, modulePath), "user-owned module");
    else if (state === "old-tool-lookup") {
      const file = join(root, "dist/modes/interactive/interactive-mode.js");
      writeFileSync(file, readFileSync(file, "utf8").replace(
        "withBuiltInRenderers(toolName, this.session.getToolDefinition(toolName))", "this.session.getToolDefinition(toolName)"));
    } else {
      expect(run(root).exitCode).toBe(0);
      if (state === "missing-module") rmSync(join(root, modulePath));
      else if (state === "residual-original") writeFileSync(join(root, last), readFileSync(join(root, last), "utf8") + edits[last][0][0]);
      else writeFileSync(join(root, modulePath), "user-owned edit");
    }
    const before = contents(root);
    expect(run(root).exitCode).not.toBe(0);
    expect(contents(root)).toEqual(before);
  }
  expect(run(join(temp, "absent")).exitCode).toBe(0);
});

const fixture = join(temp, "real-sdk");
let loaded: Promise<any> | undefined;
function real() {
  return loaded ??= (async () => {
    copySdk(sdk!, fixture);
    applySdkPatches(fixture, ["pi_horizontal_inset"]);
    // Apply the checkout's guarded migration to the disposable supported host.
    const result = run(fixture);
    if (result.exitCode) throw new Error(result.stderr.toString());
    const load = (file: string) => import(pathToFileURL(join(fixture, "dist/modes/interactive", file)).href);
    const tui = await import(pathToFileURL(join(fixture, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);
    const colors = await load("theme/theme.js");
    colors.setThemeInstance(colors.loadThemeFromPath(fileURLToPath(new URL("../themes/osaka-jade.json", import.meta.url)), "truecolor"));
    return { ...await load("components/transcript.js"), ...await load("components/user-message.js"),
      ...await load("components/assistant-message.js"), ...await load("components/tool-execution.js"),
      ...await load("interactive-mode.js"), SessionManager: (await load("../../core/session-manager.js")).SessionManager, tui, colors };
  })();
}

const timestamp = 1_750_000_000_000;
const assistant = (content: any[], extra = {}) => ({ role: "assistant", content, timestamp, stopReason: "stop", ...extra });
const toolCall = (id: string, name: string, args: object) => ({ type: "toolCall", id, name, arguments: args });
const result = (id: string, name: string, text: string, isError = false) => ({ role: "toolResult", toolCallId: id, toolName: name,
  content: [{ type: "text", text }], isError, timestamp });

function host(m: any, sessionManager = m.SessionManager.inMemory(temp)) {
  const app = Object.create(m.InteractiveMode.prototype);
  Object.assign(app, {
    isInitialized: true, chatContainer: new m.TranscriptContainer(), pendingTools: new Map(),
    loadedResourcesContainer: new m.tui.Container(), toolOutputExpanded: false, outputPad: 1,
    hideThinkingBlock: true, hiddenThinkingLabel: "Thinking…", footer: { invalidate() {} },
    ui: { requestRender() {} }, runtimeHost: { session: { retryAttempt: 0,
      sessionManager,
      settingsManager: { getShowCacheMissNotices: () => false, getShowImages: () => true, getImageWidthCells: () => 60, getShowTerminalProgress: () => false },
    } },
    getRegisteredToolDefinition: () => undefined, getMarkdownThemeWithSettings: () => m.colors.getMarkdownTheme(),
    getMarkdownTransformers: () => [], updatePendingMessagesDisplay() {}, maybeShowCacheMissNotice() {}, showStatus() {}, showError() {}, clearStatusIndicator() {},
  });
  return app;
}

function transcript(m: any, app: any, width = 90) {
  return app.chatContainer.render(width).map(m.tui.stripTerminalSequences).join("\n");
}

realTest("only the Pi speaker icon uses warning sage", async () => {
  const m = await real();
  const theme = m.colors.theme;
  const header = m.speakerHeader("Pi", undefined, 1, 80);
  expect(header).toContain(theme.fg("warning", "●"));
  expect(header).toContain(theme.bold(theme.fg("text", "Pi")));
  expect(m.speakerHeader("You", undefined, 1, 80)).toContain(theme.fg("accent", "◆"));
  expect(m.actionLines({ toolName: "read", args: { path: "a.ts" } }, 80)[0]).toContain(theme.fg("accent", "□"));
});

realTest("user separators match the editor body gutter", async () => {
  const m = await real();
  const previousPath = join(fixture, "dist/modes/interactive/components/transcript-before-separator.js");
  writeFileSync(previousPath, readFileSync(new URL("../patches/payloads/host/legacy/transcript_before_user_separator.js.inc", import.meta.url), "utf8"));
  const previous = await import(pathToFileURL(previousPath).href);
  let padding = 1;
  let height = 40;
  const app = host(m);
  app.chatContainer = new m.TranscriptContainer(() => padding, () => height);
  const messages = [
    { role: "user", content: "A question with 界🙂 and wrapping. ".repeat(3), timestamp },
    assistant([{ type: "text", text: "An answer." }]),
    { role: "user", content: "A follow-up question.", timestamp },
  ];
  const originalMessages = JSON.stringify(messages);
  app.renderSessionItems(messages);
  const children = [...app.chatContainer.children];
  const old = new previous.TranscriptContainer(() => padding, () => height);
  for (const child of children) old.addChild(child);

  for (const [width, rows, gutter] of [[120, 40, 1], [40, 12, 1], [16, 12, 1], [4, 12, 1], [120, 40, 4]]) {
    height = rows;
    padding = gutter;
    const rendered = app.chatContainer.render(width);
    const bodyPadding = width < 80 ? m.transcriptPadding(gutter, width) : Math.min(gutter + 2, width - 1);
    const separator = " ".repeat(bodyPadding) + m.colors.theme.fg("toolOutput", "─".repeat(Math.max(1, width - bodyPadding * 2))) + " ".repeat(bodyPadding);
    expect(separator).toContain("\x1b[38;2;222;222;197m");
    expect(rendered.filter((line: string) => line === separator)).toHaveLength(2);
    expect(rendered.at(-1)).toBe(separator); // Visible even before Pi responds.
    const oldSeparator = m.colors.theme.fg("toolOutput", "─".repeat(width));
    expect(rendered.filter((line: string) => line !== separator)).toEqual(old.render(width).filter((line: string) => line !== oldSeparator));
    expect(rendered.every((line: string) => m.tui.visibleWidth(line) <= width)).toBe(true);
    expect(app.chatContainer.children).toEqual(children);
  }
  expect(JSON.stringify(messages)).toBe(originalMessages);

  try {
    m.colors.setThemeInstance(m.colors.loadThemeFromPath(fileURLToPath(new URL("../themes/woody.json", import.meta.url)), "truecolor"));
    app.chatContainer.invalidate();
    const bodyPadding = Math.min(padding + 2, 90 - 1);
    const separator = app.chatContainer.render(90).at(-1)!;
    expect(m.tui.stripTerminalSequences(separator)).toBe(" ".repeat(bodyPadding) + "─".repeat(90 - bodyPadding * 2) + " ".repeat(bodyPadding));
    expect(separator).toContain(m.colors.theme.getFgAnsi("toolOutput"));
  } finally {
    m.colors.setThemeInstance(m.colors.loadThemeFromPath(fileURLToPath(new URL("../themes/osaka-jade.json", import.meta.url)), "truecolor"));
    app.chatContainer.invalidate();
  }
});

realTest("real streaming and replay share Pi/You headers, grouped actions and narration boundaries", async () => {
  const m = await real();
  const user = { role: "user", content: "Trace authentication.", timestamp };
  const call1 = assistant([{ type: "text", text: "I’ll inspect the handler." }, toolCall("a", "read", { path: "session.ts" }), toolCall("b", "grep", { pattern: "expiry", path: "src" })]);
  const middle = assistant([{ type: "text", text: "Now verify the failure." }, toolCall("c", "bash", { command: "bun test auth" })]);
  const done = assistant([{ type: "text", text: "The expiry check is incorrect." }]);
  const a = result("a", "read", "SECRET_EXPANDED_DETAIL");
  const b = result("b", "grep", "src/session.ts:5: expiry");
  const c = result("c", "bash", "Expected an active session", true);
  const items = [user, call1, a, b, middle, c, done];
  const live = host(m);
  await live.handleEvent({ type: "message_start", message: user });
  for (const [message, results] of [[call1, [b, a]], [middle, [c]], [done, []]] as const) {
    await live.handleEvent({ type: "message_start", message });
    await live.handleEvent({ type: "message_update", message });
    await live.handleEvent({ type: "message_end", message });
    for (const item of results) {
      await live.handleEvent({ type: "tool_execution_start", toolCallId: item.toolCallId, toolName: item.toolName, args: {} });
      await live.handleEvent({ type: "tool_execution_end", toolCallId: item.toolCallId, result: item, isError: item.isError });
      live.sessionManager.appendMessage(item);
    }
  }
  const history = host(m, live.sessionManager);
  history.renderSessionItems(items);
  expect(transcript(m, live)).toBe(transcript(m, history));
  const text = transcript(m, live);
  expect(text.match(/● Pi/g)).toHaveLength(1);
  expect(text.match(/◆ You/g)).toHaveLength(1);
  const separator = " ".repeat(3) + "─".repeat(84) + " ".repeat(3);
  expect(text.split("\n").filter((line: string) => line === separator)).toHaveLength(1);
  expect(text.indexOf("Trace authentication.")).toBeLessThan(text.indexOf(separator));
  expect(text.indexOf(separator)).toBeLessThan(text.indexOf("● Pi"));
  expect(text).toContain("2 actions");
  expect(text).not.toContain("1 action");
  expect(text).toContain("├─ ✓ □ Read");
  expect(text).toContain("╰─ ✓ ◎ Search");
  expect(text).toContain("\n      × ↯ Run");
  expect(text).toContain("Expected an active session");
  expect(text).not.toContain("SECRET_EXPANDED_DETAIL");
  expect(text.indexOf("session.ts")).toBeLessThan(text.indexOf("expiry"));
  expect(text.indexOf("expiry")).toBeLessThan(text.indexOf("Now verify"));
  expect(text.indexOf("Now verify")).toBeLessThan(text.indexOf("bun test auth"));
  expect(text.indexOf("bun test auth")).toBeLessThan(text.indexOf("The expiry check"));

  const children = [...live.chatContainer.children];
  live.setToolsExpanded(true);
  expect(transcript(m, live)).toContain("SECRET_EXPANDED_DETAIL");
  expect(transcript(m, live)).not.toContain("2 actions");
  live.setToolsExpanded(false);
  expect(transcript(m, live)).toBe(text);
  expect(live.chatContainer.children).toEqual(children);
  expect(call1.content).toHaveLength(3);

  // Clearing/rebuilding and changing the theme's caches must not retain a speaker.
  live.chatContainer.clear();
  live.renderSessionItems(items);
  live.chatContainer.invalidate();
  expect(transcript(m, live)).toBe(text);
});

realTest("parallel timings persist outside model context and replay from only the active branch", async () => {
  const m = await real();
  const manager = m.SessionManager.create(temp, join(temp, "timing-sessions"));
  const app = host(m, manager);
  const user = { role: "user", content: "Read both files.", timestamp };
  const call = assistant([toolCall("a", "read", { path: "a.ts" }), toolCall("b", "read", { path: "b.ts" })]);
  manager.appendMessage(user);
  const branchPoint = manager.appendMessage(call);
  const results = [
    { ...result("a", "read", "one\ntwo\n"), details: { configsTranscript: { lines: 2 } } },
    { ...result("b", "read", "three\n"), details: { configsTranscript: { lines: 1 } } },
  ];

  for (const id of ["a", "b"]) {
    await app.handleEvent({ type: "tool_execution_start", toolCallId: id, toolName: "read", args: { path: `${id}.ts` } });
  }
  await app.handleEvent({ type: "tool_execution_update", toolCallId: "a", toolName: "read", partialResult: results[0] });
  expect(manager.configsToolTimings.size).toBe(0);
  const liveTools = new Map(app.pendingTools);
  // Completion order differs from call/result-message order, as in parallel execution.
  for (const item of [results[1], results[0]]) {
    await app.handleEvent({ type: "tool_execution_end", toolCallId: item.toolCallId, toolName: "read", result: item, isError: false });
  }
  expect([...manager.configsToolTimings.keys()]).toEqual(["b", "a"]);
  for (const item of results) manager.appendMessage(item);
  expect(manager.configsToolTimings.size).toBe(0);
  const timings = manager.getBranch().filter((entry: any) => entry.configsToolTiming);
  expect(timings.map((entry: any) => entry.configsToolTiming.toolCallId)).toEqual(["a", "b"]);
  expect(timings.every((entry: any) => Number.isFinite(entry.configsToolTiming.durationMs) && entry.configsToolTiming.durationMs >= 0)).toBe(true);
  expect(manager.buildSessionContext().messages).toEqual([user, call, ...results]);

  const reopened = m.SessionManager.open(manager.getSessionFile());
  const replay = host(m, reopened);
  replay.renderSessionEntries(reopened.buildContextEntries());
  const replayTools = replay.chatContainer.children.filter((child: any) => child.transcriptRole === "tool");
  expect(replayTools).toHaveLength(2);
  for (const component of replayTools) {
    const live = liveTools.get(component.toolCallId);
    expect(component.transcriptDurationMs).toBe(live.transcriptDurationMs);
    for (const width of [90, 40, 24]) expect(m.actionLines(component, width)).toEqual(m.actionLines(live, width));
  }
  expect(transcript(m, replay)).not.toContain(m.TOOL_TIMING_FIELD);

  // Message-only rebuilds have no entry-wrapper metadata of their own.
  replay.chatContainer.clear();
  replay.renderSessionItems([call, ...results]);
  expect(replay.chatContainer.children.filter((child: any) => child.transcriptRole === "tool")
    .map((child: any) => child.transcriptDurationMs)).toEqual(replayTools.map((child: any) => child.transcriptDurationMs));

  reopened.appendCompaction("Earlier context summarized", branchPoint, 1000);
  replay.chatContainer.clear();
  replay.renderSessionEntries(reopened.buildContextEntries());
  expect(replay.chatContainer.children.filter((child: any) => child.transcriptRole === "tool")
    .map((child: any) => child.transcriptDurationMs)).toEqual(replayTools.map((child: any) => child.transcriptDurationMs));

  // Pi keeps entries via firstKeptEntryId; verify an actual compacted-file reopen.
  const compactedManager = m.SessionManager.open(reopened.getSessionFile());
  const compactedReplay = host(m, compactedManager);
  compactedReplay.renderSessionEntries(compactedManager.buildContextEntries());
  expect(compactedReplay.chatContainer.children.filter((child: any) => child.transcriptRole === "tool")
    .map((child: any) => child.transcriptDurationMs)).toEqual(replayTools.map((child: any) => child.transcriptDurationMs));

  reopened.branch(branchPoint);
  replay.chatContainer.clear();
  replay.renderSessionEntries(reopened.buildContextEntries());
  expect(replay.chatContainer.children.filter((child: any) => child.transcriptRole === "tool")
    .every((child: any) => child.transcriptDurationMs === undefined)).toBe(true);
});

realTest("calls cancelled before starting never queue a timing", async () => {
  const m = await real();
  const queued = host(m);
  const message = assistant([toolCall("queued", "read", { path: "queued.ts" })]);
  await queued.handleEvent({ type: "message_start", message });
  await queued.handleEvent({ type: "message_update", message });
  const pending = queued.pendingTools.get("queued");
  await queued.handleEvent({ type: "message_end", message: { ...message, stopReason: "aborted" } });
  expect(pending.result.isError).toBe(true);
  expect(pending.transcriptDurationMs).toBeUndefined();
  expect(queued.sessionManager.configsToolTimings.size).toBe(0);
});

realTest("timing adds no independent writes or history nodes and shares the canonical result write", async () => {
  const m = await real();
  const directory = join(temp, "timing-single-write");
  const manager = m.SessionManager.create(temp, directory);
  const user = { role: "user", content: "Read a.ts", timestamp };
  const call = assistant([toolCall("a", "read", { path: "a.ts" })]);
  const output = { ...result("a", "read", "file content"), details: "custom scalar details stay intact" };
  manager.appendMessage(user);
  manager.appendMessage(call);
  const originalEntries = manager.getEntries();
  const originalLeaf = manager.getLeafId();
  const originalFile = readFileSync(manager.getSessionFile(), "utf8");
  const writes: any[] = [];
  const persist = manager._persist;
  manager._persist = function (entry: any) {
    writes.push(entry);
    return persist.call(this, entry);
  };
  const app = host(m, manager);
  await app.handleEvent({ type: "tool_execution_start", toolCallId: "a", toolName: "read", args: { path: "a.ts" } });
  // A timing observation must not touch disk, even when session storage is unavailable.
  renameSync(directory, `${directory}-offline`);
  try {
    await app.handleEvent({ type: "tool_execution_end", toolCallId: "a", toolName: "read", result: output, isError: false });
  } finally {
    renameSync(`${directory}-offline`, directory);
  }
  expect(writes).toHaveLength(0);
  expect(manager.getEntries()).toEqual(originalEntries);
  expect(manager.getLeafId()).toBe(originalLeaf);
  expect(readFileSync(manager.getSessionFile(), "utf8")).toBe(originalFile);
  const id = manager.appendMessage(output);
  expect(writes).toHaveLength(1);
  expect(manager.getEntry(id).message).toBe(output);
  expect(manager.getEntry(id).configsToolTiming.toolCallId).toBe("a");
  expect(output.details).toBe("custom scalar details stay intact");
  expect(manager.configsToolTimings.size).toBe(0);
  const reopened = m.SessionManager.open(manager.getSessionFile());
  expect(reopened.buildSessionContext().messages).toEqual([user, call, output]);
  expect(m.collectToolTimings(reopened.getBranch()).size).toBe(1);

  // Native canonical-write errors remain visible to the caller, never swallowed/retried.
  const failing = m.SessionManager.inMemory(temp);
  failing.configsToolTimings.set("a", { toolCallId: "a", toolName: "read", durationMs: 100 });
  failing._persist = () => { throw new Error("canonical write failed"); };
  expect(() => failing.appendMessage(output)).toThrow("canonical write failed");
});

realTest("pending timing queues clear on run and session boundaries; persisted branch copies retain metadata", async () => {
  const m = await real();
  const timing = { toolCallId: "a", toolName: "read", durationMs: 1250 };
  const manager = m.SessionManager.create(temp, join(temp, "timing-boundaries"));
  manager.appendMessage(assistant([toolCall("a", "read", { path: "a.ts" })]));
  manager.configsToolTimings.set("a", timing);
  const resultId = manager.appendMessage(result("a", "read", "ok"));
  const savedFile = manager.getSessionFile();

  const mutations = [
    () => manager.createBranchedSession(resultId),
    () => manager.setSessionFile(savedFile),
    () => manager.branch(resultId),
    () => manager.resetLeaf(),
    () => manager.newSession(),
  ];
  for (const mutate of mutations) {
    manager.configsToolTimings.set("abandoned", { ...timing, toolCallId: "abandoned" });
    mutate();
    expect(manager.configsToolTimings.size).toBe(0);
  }
  const original = m.SessionManager.open(savedFile);
  const copiedFile = original.createBranchedSession(resultId);
  const copied = m.SessionManager.open(copiedFile);
  expect(m.collectToolTimings(copied.getBranch()).get("a")).toEqual(timing);

  const memory = m.SessionManager.inMemory(temp);
  const memoryId = memory.appendMessage({ role: "user", content: "branch", timestamp });
  memory.configsToolTimings.set("a", timing);
  memory.createBranchedSession(memoryId);
  expect(memory.configsToolTimings.size).toBe(0);
  const app = host(m, memory);
  memory.configsToolTimings.set("abandoned", timing);
  await app.handleEvent({ type: "agent_end" });
  expect(memory.configsToolTimings.size).toBe(0);
});

realTest("session entries attach only valid matching primitive timing fields", async () => {
  const m = await real();
  const manager = m.SessionManager.inMemory(temp);
  const timing = { toolCallId: "a", toolName: "read", durationMs: 100 };
  for (const record of [null, { ...timing, toolCallId: "wrong" }, { ...timing, toolName: "edit" },
    { ...timing, durationMs: -1 }, { ...timing, durationMs: Infinity }, { ...timing, durationMs: "100" }]) {
    manager.configsToolTimings.set("a", record);
    const id = manager.appendMessage(result("a", "read", "ok"));
    expect(manager.getEntry(id).configsToolTiming).toBeUndefined();
    expect(manager.configsToolTimings.size).toBe(0);
  }
  manager.configsToolTimings.set("a", { ...timing, extra: { notPersisted: true } });
  const id = manager.appendMessage(result("a", "read", "ok"));
  expect(manager.getEntry(id).configsToolTiming).toEqual(timing);
  manager.configsToolTimings.set("a", timing);
  const userId = manager.appendMessage({ role: "user", content: "No timing on users", toolCallId: "a", toolName: "read", timestamp });
  expect(manager.getEntry(userId).configsToolTiming).toBeUndefined();
});

realTest("historical result timestamps never become inferred timings", async () => {
  const m = await real();
  const app = host(m);
  app.renderSessionItems([
    assistant([toolCall("old", "read", { path: "old.ts" })]),
    { ...result("old", "read", "old content"), timestamp: timestamp + 10_000 },
  ]);
  const tool = app.chatContainer.children.find((child: any) => child.transcriptRole === "tool");
  expect(tool.transcriptDurationMs).toBeUndefined();
  expect(m.tui.stripTerminalSequences(m.actionLines(tool, 40)[0])).not.toMatch(/\d+(?:\.\d+)?s/);
});

realTest("partial calls, unsafe arguments, error-only turns and narrow Unicode rows stay readable", async () => {
  const m = await real();
  const app = host(m);
  const component = new m.ToolExecutionComponent("read", "pending", {}, {}, undefined, app.ui, temp);
  app.chatContainer.addChild(component);
  expect(transcript(m, app)).toContain("○ □ Read");
  component.markExecutionStarted();
  component.updateArgs({ path: "界🙂\n\x1b[31msecret\x1b]0;injected\x07.ts", offset: 4 });
  expect(transcript(m, app)).toContain("◌ □ Read");
  expect(transcript(m, app)).not.toContain("injected");
  component.updateResult(result("pending", "read", "Operation aborted", true));
  expect(transcript(m, app)).toContain("Operation aborted");
  app.chatContainer.addChild(new m.AssistantMessageComponent(assistant([{ type: "text", text: "Stopped." }])));
  expect(transcript(m, app).match(/● Pi/g)).toHaveLength(1);
  app.chatContainer.addChild(new m.UserMessageComponent("界🙂 Hello"));
  app.chatContainer.addChild(new m.AssistantMessageComponent(assistant([{ type: "text", text: "界🙂 Hello" }])));
  for (const width of [90, 40, 20, 12, 8, 7, 6, 5, 4, 90]) {
    const rows = app.chatContainer.render(width);
    expect(rows.every((line: string) => m.tui.visibleWidth(line) <= width)).toBe(true);
  }
  const errorOnly = new m.AssistantMessageComponent(assistant([], { stopReason: "error", errorMessage: "Request failed" }));
  expect(errorOnly.render(80).map(m.tui.stripTerminalSequences).join("\n")).toContain("Request failed");
  const answer = new m.AssistantMessageComponent(assistant([{ type: "text", text: "Answer." }]));
  expect(answer.render(80).join("")).toContain("\x1b]133;A\x07");
  expect(answer.render(80).join("")).toContain("\x1b]133;C\x07");
});

realTest("regular and fullscreen hosts render the same transcript inside the existing inset", async () => {
  const m = await real();
  for (const [mode, scrollbar] of [["regular", "hidden"], ["fullscreen", "auto"], ["fullscreen", "always"]] as const) {
    const app = host(m);
    app.renderSessionItems([
      { role: "user", content: "Inspect session.ts", timestamp },
      assistant([toolCall("r", "read", { path: "session.ts" })]),
      result("r", "read", "FULL DETAIL"),
      assistant([{ type: "text", text: "Verified the session." }]),
    ]);
    const terminal = { columns: 90, rows: 30, write() {}, hideCursor() {}, showCursor() {}, start() {}, stop() {} };
    const tui = m.createInteractiveTui({ tuiMode: mode, terminal });
    tui.requestRender = () => {};
    tui.requestImmediateRender = () => {};
    const footer = new m.tui.Text("UNCHANGED FOOTER", 0, 0);
    if (mode === "regular") {
      tui.addChild(app.chatContainer);
      tui.addChild(footer);
    } else {
      tui.altScreenActive = true;
      tui.setLayoutRoot(new m.tui.VStack([
        { component: new m.tui.ScrollView(app.chatContainer, { scrollbar }), basis: 0, grow: 1 },
        { component: footer, basis: 1 },
      ]));
    }
    for (const width of [90, 40, 20]) {
      terminal.columns = width;
      tui.renderNow();
      const lines = mode === "regular" ? tui.previousLines : tui.previousScreen;
      const text = lines.map(m.tui.stripTerminalSequences).join("\n");
      expect(text).toContain("Pi");
      expect(text).toContain("You");
      expect(text).toContain("Read");
      expect(text).toContain("UNCHANGED FOOTER");
      const inset = tui.getHorizontalInset(width);
      const track = mode === "fullscreen" && scrollbar === "always" ? 1 : 0;
      const separator = lines.map(m.tui.stripTerminalSequences).find((line: string) => line.trimStart().startsWith("──"));
      // 0.85.1 paints the always-visible scrollbar even without overflowing content.
      // Compare the transcript columns separately from that native track column.
      const contentWidth = width - 2 * inset - track;
      const bodyPadding = contentWidth < 80 ? m.transcriptPadding(1, contentWidth) : Math.min(3, contentWidth - 1);
      expect(separator?.slice(inset, width - inset - track)).toBe(" ".repeat(bodyPadding) + "─".repeat(contentWidth - 2 * bodyPadding) + " ".repeat(bodyPadding));
      expect(lines.every((line: string) => m.tui.visibleWidth(line) <= width)).toBe(true);
    }
  }
});

realTest("default tool bodies share transcript gutters without clipping wrapped Intercom output", async () => {
  const m = await real();
  const app = host(m);
  let outerPad = 1;
  app.chatContainer = new m.TranscriptContainer(() => outerPad);
  const intercom = {
    renderCall: () => new m.tui.Text(m.colors.theme.fg("accent", "intercom list-cwd"), 0, 0),
    renderResult: (output: any) => new m.tui.Text(m.colors.theme.fg("text", output.content[0].text), 0, 0),
  };
  // Intercom's actual renderer uses zero-padding Text components inside Pi's Box.
  // The generic fallback uses the host's Text instead; both share the same gutter.
  for (const definition of [intercom, undefined]) {
    const tool = new m.ToolExecutionComponent("intercom", "padding", {}, {}, definition, app.ui, temp);
    tool.setExpanded(true); // Every collapsed body uses the shared row.
    const output = result("padding", "intercom", "Current session:\n" + "界🙂 long session description ".repeat(20));
    tool.updateResult(output);
    app.chatContainer.clear();
    app.chatContainer.addChild(tool);
    const children = [...app.chatContainer.children];
    const state = tool.rendererState;

    for (const [width, pad] of [[120, 1], [90, 1], [80, 1], [79, 1], [40, 1], [12, 1], [8, 1], [90, 5], [90, 1]]) {
      outerPad = pad;
      const expectedPad = width < 80 ? 1 : pad + 2;
      const lines = app.chatContainer.render(width);
      const native = tool.render(width);
      const text = native.map(m.tui.stripTerminalSequences).filter((line: string) => line.trim());
      expect(text[0].match(/^ */)[0].length).toBe(expectedPad);
      expect(text.every((line: string) => line.startsWith(" ".repeat(expectedPad)) && line.endsWith(" ".repeat(expectedPad)))).toBe(true);
      expect(lines.every((line: string) => m.tui.visibleWidth(line) <= width)).toBe(true);
      expect(lines.slice(-native.length)).toEqual(native);
      expect(app.chatContainer.children).toEqual(children);
      expect(tool.result).toBe(output);
      expect(tool.rendererState).toBe(state);
    }
    tool.setExpanded(true);
    const expanded = app.chatContainer.render(90).map(m.tui.stripTerminalSequences);
    expect(expanded.find((line: string) => line.trimStart().startsWith("intercom"))).toMatch(/^   intercom/);
  }
});

realTest("native gutter changes leave self-framed and image bodies unchanged", async () => {
  const m = await real();
  const app = host(m);
  const definition = {
    renderCall: () => new m.tui.Text("native call", 0, 0),
    renderResult: () => new m.tui.Text("native result", 0, 0),
  };
  for (const renderShell of ["default", "self"]) {
    const create = () => new m.ToolExecutionComponent("custom", "native-padding", {}, { showImages: false },
      { ...definition, renderShell }, app.ui, temp);
    const tool = create();
    tool.setExpanded(true);
    app.chatContainer.clear();
    app.chatContainer.addChild(tool);
    tool.updateResult(result("native-padding", "custom", "text first"));
    app.chatContainer.render(90);

    // A streamed image result must restore the native gutter, not retain the text gutter.
    const output = { content: [{ type: "image", data: "AA==", mimeType: "image/png" }], isError: false };
    tool.updateResult(output);
    const untouched = create();
    untouched.setExpanded(true);
    untouched.updateResult(output);
    const lines = app.chatContainer.render(90);
    const native = untouched.render(90);
    expect(lines.slice(-native.length)).toEqual(native);
    expect(tool.render(90)).toEqual(native);
  }
});

realTest("native images remain inline without custom cards across protocols, streaming and expansion", async () => {
  const m = await real();
  const previous = m.tui.getCapabilities();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=";
  try {
    for (const images of ["kitty", "iterm2", null]) {
      m.tui.setCapabilities({ ...previous, images });
      for (const renderShell of ["default", "self"]) {
        const app = host(m);
        const tool = new m.ToolExecutionComponent("fetch_content", "image-preview", { url: "https://example.com/a.png" }, {}, {
          renderShell,
          renderCall: () => new m.tui.Text("CUSTOM CALL CARD", 0, 0),
          renderResult: () => new m.tui.Text("CUSTOM RESULT CARD", 0, 0),
        }, app.ui, temp);
        app.chatContainer.addChild(tool);
        const result = { content: [{ type: "text", text: "IMAGE CONTENT" }, { type: "image", data: png, mimeType: "image/png" }], isError: false };
        for (const partial of [true, false]) {
          tool.updateResult(result, partial);
          for (const width of [100, 40, 12, 100]) {
            const imageRows = tool.imageComponents.flatMap((image: any, i: number) => [
              ...tool.imageSpacers[i].render(width), ...image.render(width),
            ]);
            expect(imageRows.length > 0).toBe(images !== null);
            const collapsed = app.chatContainer.render(width);
            expect(collapsed.join("\n")).not.toContain("CUSTOM");
            if (imageRows.length) expect(collapsed.slice(-imageRows.length)).toEqual(imageRows);
            tool.setExpanded(true);
            const expanded = app.chatContainer.render(width);
            if (width >= 40) expect(expanded.join("\n")).toContain("CUSTOM CALL CARD");
            // Native expansion rebuilds image instances (and Kitty IDs); compare current components.
            const expandedImages = tool.imageComponents.flatMap((image: any, i: number) => [
              ...tool.imageSpacers[i].render(width), ...image.render(width),
            ]);
            if (expandedImages.length) expect(expanded.slice(-expandedImages.length)).toEqual(expandedImages);
            tool.setExpanded(false);
          }
        }
        tool.setShowImages(false);
        expect(tool.imageComponents).toHaveLength(0);
        expect(transcript(m, app)).not.toContain("CUSTOM");
        expect(tool.result).toBe(result);
        tool.updateResult({ content: [{ type: "text", text: "TEXT ONLY" }] }, true);
        expect(tool.imageComponents).toHaveLength(0);
        expect(transcript(m, app)).not.toContain("TEXT ONLY");
      }
    }
  } finally {
    m.tui.setCapabilities(previous);
  }
});

realTest("mouse events reach visible native bodies, never collapsed custom cards", async () => {
  const m = await real();
  const app = host(m);
  const events: any[] = [];
  const clickable = { render: () => ["CLICK_CARD"], invalidate() {}, handleMouse(event: any) {
    events.push(event); return { handled: true };
  } };
  const tool = new m.ToolExecutionComponent("custom", "clickable", {}, {}, {
    renderShell: "self", renderCall: () => clickable,
  }, app.ui, temp);
  app.chatContainer.addChild(tool);
  for (const width of [80, 40]) {
    tool.setExpanded(true);
    const rows = app.chatContainer.render(width);
    const y = rows.findIndex((line: string) => line.includes("CLICK_CARD"));
    expect(y).toBeGreaterThan(0);
    events.length = 0;
    app.chatContainer.handleMouse({ x: 0, y, width, height: rows.length, type: "press", button: "left" });
    expect(events).toHaveLength(1);
    expect(events[0].y).toBe(0);
    tool.setExpanded(false);
    const collapsed = app.chatContainer.render(width);
    events.length = 0;
    for (let y = 0; y < collapsed.length; y++) {
      app.chatContainer.handleMouse({ x: 0, y, width, height: collapsed.length, type: "press", button: "left" });
    }
    expect(events).toHaveLength(0);
    expect(collapsed.join("\n")).not.toContain("CLICK_CARD");
  }
});

realTest("host renderer lookup retains built-in fallbacks and canonical source metadata", async () => {
  const m = await real();
  const { readRenderers } = await import(pathToFileURL(join(fixture, "dist/core/tools/renderers/index.js")).href);
  const app = host(m);
  const customCall = () => new m.tui.Text("CUSTOM CALL", 0, 0);
  app.runtimeHost.session.getAllTools = () => [{ name: "read", sourceInfo: { source: "builtin" } }];
  for (const definition of [undefined, { renderCall: customCall }]) {
    app.runtimeHost.session.getToolDefinition = () => definition;
    const registered = m.InteractiveMode.prototype.getRegisteredToolDefinition.call(app, "read");
    expect(registered.renderCall).toBe(definition?.renderCall ?? readRenderers.renderCall);
    expect(registered.renderResult).toBe(readRenderers.renderResult);
    expect(registered.configsTranscriptSource).toBe("builtin");
    expect(registered.configsTranscriptCompact).toBeUndefined();
  }
  app.runtimeHost.session.getToolDefinition = () => undefined;
  expect(m.InteractiveMode.prototype.getRegisteredToolDefinition.call(app, "unknown")).toBeUndefined();
});

realTest("all web and MCP tools use one row while expansion retains native cards", async () => {
  const m = await real();
  const app = host(m);
  const definition = {
    renderCall: () => new m.tui.Text("get_content urlIndex=0", 0, 0),
    renderResult: (output: any, { expanded }: { expanded: boolean }) => new m.tui.Text(
      output.details?.error ?? "Hello world example · Express.js (1611 chars, showing 0-1611)"
        + (expanded ? `\n${output.content[0].text}` : ""), 0, 0),
  };
  for (const [name, owner] of [
    ["get_search_content", "npm:pi-web-access"],
    ["get_search_content", "npm:pi-web-access@0.27.0"],
    ["get_search_content", "npm:pi-web-access@0.28.0"],
    ["get_search_content", "npm:pi-web-access-spoof"],
    ["get_search_content", "project-extension"],
    ["web_search", "npm:pi-web-access"],
    ["fetch_content", "npm:pi-web-access"],
    ["source_check", "npm:pi-web-access"],
    ["mcp", "npm:pi-mcp-adapter"],
    ["mcp__exa", "npm:pi-mcp-adapter"],
    ["mcpScript", "npm:pi-mcp-adapter"],
    ["exa_web_search_exa", "npm:pi-mcp-adapter"],
  ] as const) {
    app.runtimeHost.session.getToolDefinition = () => definition;
    app.runtimeHost.session.getAllTools = () => [{ name, sourceInfo: { source: owner } }];
    const registered = m.InteractiveMode.prototype.getRegisteredToolDefinition.call(app, name);
    const tool = new m.ToolExecutionComponent(name, "source-read", { urlIndex: 0 }, {}, registered, app.ui, temp);
    app.chatContainer.clear();
    app.chatContainer.addChild(tool);
    expect(transcript(m, app)).toContain(name);
    expect(transcript(m, app)).not.toContain("get_content urlIndex=0");

    const output = result("source-read", name, "FULL SOURCE CONTENT");
    tool.updateResult(output);
    tool.transcriptDurationMs = 10;
    const collapsed = transcript(m, app);
    expect(collapsed).toContain(`${name}(urlIndex=0) <0.1s`);
    expect(collapsed).toContain("✓");
    expect(collapsed).not.toContain("get_content urlIndex=0");
    expect(collapsed).not.toContain("1611 chars");
    expect(tool.result).toBe(output);

    tool.setExpanded(true);
    expect(transcript(m, app)).toContain("get_content urlIndex=0");
    expect(transcript(m, app)).toContain("1611 chars");
    expect(transcript(m, app)).toContain("FULL SOURCE CONTENT");
    tool.setExpanded(false);

    // pi-web-access reports lookup failures in details.error without isError.
    if (name === "get_search_content" && (owner === "npm:pi-web-access" || owner.startsWith("npm:pi-web-access@"))) {
      const failed = { ...output, details: { error: "Stored response not found" } };
      tool.updateResult(failed);
      expect(transcript(m, app)).toContain("Stored response not found");
      expect(tool.result).toBe(failed);
    }

    tool.updateResult(result("source-read", name, "Execution failed", true));
    expect(transcript(m, app)).toContain("×");
    expect(transcript(m, app)).toContain("Execution failed");
  }
  expect((definition as any).configsTranscriptSource).toBeUndefined();
});

realTest("builtin-name overrides keep custom cards only when expanded regardless of owner", async () => {
  const m = await real();
  const app = host(m);
  const renderCall = () => new m.tui.Text("CUSTOM CALL CARD", 0, 0);
  const renderResult = () => new m.tui.Text("CUSTOM RESULT CARD", 0, 0);
  for (const slots of [{ renderCall }, { renderResult }, { renderCall, renderResult }]) {
    const definition = { renderShell: "self", ...slots };
    for (const owner of ["builtin", "npm:@heyhuynhgiabuu/pi-pretty", "npm:@heyhuynhgiabuu/pi-pretty@1.0.0", "project-extension"]) {
      app.runtimeHost.session.getToolDefinition = () => definition;
      app.runtimeHost.session.getAllTools = () => [{ name: "read", sourceInfo: { source: owner } }];
      const registered = m.InteractiveMode.prototype.getRegisteredToolDefinition.call(app, "read");
      expect(registered.configsTranscriptSource).toBe(owner);
      expect((definition as any).configsTranscriptSource).toBeUndefined();
      const component = new m.ToolExecutionComponent("read", "override", { path: "a.ts" }, {}, registered, app.ui, temp);
      component.updateResult(result("override", "read", "result body"));
      app.chatContainer.clear();
      app.chatContainer.addChild(component);
      expect(transcript(m, app)).not.toContain("1 action");
      expect(transcript(m, app)).toContain("\n      ✓ □ Read");
      expect(transcript(m, app)).not.toContain("CUSTOM");
      component.setExpanded(true);
      expect(transcript(m, app)).toContain("CUSTOM");
      const native = component.render(90);
      expect(app.chatContainer.render(90).slice(-native.length)).toEqual(native);
    }
  }
});

realTest("custom renderers, hidden tools, image output and Markdown transformations are preserved", async () => {
  const m = await real();
  const app = host(m);
  const card = new m.ToolExecutionComponent("workflow", "card", {}, {}, {
    renderShell: "self", renderCall: () => ({ render: () => ["CUSTOM INTERACTIVE CARD"], invalidate() {} }),
  }, app.ui, temp);
  app.chatContainer.addChild(Object.freeze({ render: () => ["CUSTOM NOTICE"], invalidate() {} }));
  app.chatContainer.addChild(card);
  expect(transcript(m, app)).toContain("CUSTOM NOTICE");
  expect(transcript(m, app)).not.toContain("CUSTOM INTERACTIVE CARD");
  card.setExpanded(true);
  expect(transcript(m, app)).toContain("CUSTOM INTERACTIVE CARD");
  expect(transcript(m, app)).not.toContain("1 action");
  expect(transcript(m, app)).toMatch(/^ {6}○ ⌇ Tool\s+workflow/m);
  expect(transcript(m, app).indexOf("Tool")).toBeLessThan(transcript(m, app).indexOf("CUSTOM INTERACTIVE CARD"));
  const hidden = new m.ToolExecutionComponent("read", "hidden", {}, {}, {
    renderShell: "self", renderCall: () => ({ render: () => [], invalidate() {} }),
  }, app.ui, temp);
  app.chatContainer.addChild(hidden);
  expect(transcript(m, app)).toContain("Read");

  const image = new m.ToolExecutionComponent("read", "image", { path: "test.png" }, { showImages: false }, undefined, app.ui, temp);
  image.updateResult({ content: [{ type: "image", data: "AA==", mimeType: "image/png" }], isError: false });
  app.chatContainer.addChild(image);
  expect(app.chatContainer.render(90).join("\n")).not.toContain(image.render(90).join("\n"));
  expect(transcript(m, app)).toContain("2 actions");

  const contexts: any[] = [];
  const transform = (text: string, context: any) => { contexts.push(context); return text.replace("user text", "TRANSFORMED"); };
  const user = new m.UserMessageComponent("user text", undefined, 1, [transform]);
  const rendered = user.render(80).join("");
  expect(rendered).toContain("TRANSFORMED");
  expect(rendered).toContain("\x1b]133;A\x07");
  expect(contexts[0].messageType).toBe("user");
  expect(contexts[0].availableWidth).toBeLessThan(80);
});

realTest("silent tools retain named invocation rows through execution, expansion, resize and replay", async () => {
  const m = await real();
  const definition = {
    renderShell: "self",
    renderCall: () => new m.tui.Text("", 0, 0),
    renderResult: () => new m.tui.Text("", 0, 0),
  };
  const app = host(m);
  app.getRegisteredToolDefinition = () => definition;
  const call = assistant([
    toolCall("s", "mcpScript", { code: 'emit("PUBLIC_ARGUMENTS")', apiKey: "DO_NOT_ECHO_ARGUMENTS" }),
    toolCall("f", "quiet_tool", {}),
  ]);
  app.sessionManager.appendMessage(call);
  await app.handleEvent({ type: "message_start", message: call });
  await app.handleEvent({ type: "message_update", message: call });
  await app.handleEvent({ type: "message_end", message: call });
  expect(transcript(m, app)).toMatch(/○ ⋈ Batch\s+mcpScript/);
  expect(transcript(m, app)).toContain("2 actions");

  const results = [result("s", "mcpScript", "HIDDEN_RESULT"), result("f", "quiet_tool", "Permission denied", true)];
  for (const item of results) {
    const event = { toolCallId: item.toolCallId, toolName: item.toolName };
    await app.handleEvent({ type: "tool_execution_start", ...event, args: {} });
    const heading = item.toolName === "mcpScript" ? "⋈ Batch" : "⌇ Tool";
    expect(transcript(m, app)).toMatch(new RegExp(`◌ ${heading}\\s+${item.toolName}`));
    await app.handleEvent({ type: "tool_execution_update", ...event, partialResult: { content: [{ type: "text", text: "PARTIAL_RESULT" }] } });
    expect(transcript(m, app)).toMatch(new RegExp(`◌ ${heading}\\s+${item.toolName}`));
    await app.handleEvent({ type: "tool_execution_end", ...event, result: item, isError: item.isError });
    app.sessionManager.appendMessage(item);
  }
  const finished = transcript(m, app);
  expect(finished).toMatch(/✓ ⋈ Batch\s+mcpScript/);
  expect(finished).toMatch(/× ⌇ Tool\s+quiet_tool/);
  expect(finished).toContain("Permission denied");
  expect(finished).not.toContain("HIDDEN_RESULT");
  expect(finished).not.toContain("DO_NOT_ECHO_ARGUMENTS");

  const children = [...app.chatContainer.children];
  for (const expanded of [true, false]) {
    app.setToolsExpanded(expanded);
    for (const width of [40, 70, 120, 70, 40, 90]) {
      const rendered = app.chatContainer.render(width);
      const text = rendered.map(m.tui.stripTerminalSequences).join("\n");
      expect(text).toMatch(/⋈ Batch\s+mcpScript/);
      expect(text).toMatch(/⌇ Tool\s+quiet_tool/);
      expect(text).toContain("2 actions");
      expect(rendered.every((line: string) => m.tui.visibleWidth(line) <= width)).toBe(true);
      expect(app.chatContainer.children).toEqual(children);
    }
  }
  expect(transcript(m, app)).toBe(finished);
  const replay = host(m, app.sessionManager);
  replay.getRegisteredToolDefinition = () => definition;
  replay.renderSessionItems([call, ...results]);
  expect(transcript(m, replay)).toBe(finished);

  // Arbitrary arguments cannot spoof a label; credentials never enter the shared row.
  const line = m.actionLines({ toolName: "constructor", args: { apiKey: "DO_NOT_ECHO_ARGUMENTS" } }, 90)[0];
  expect(m.tui.stripTerminalSequences(line)).toMatch(/⌇ Tool\s+constructor/);
  expect(line).not.toContain("DO_NOT_ECHO_ARGUMENTS");
});

realTest("tool families and all MCP entrypoints receive explicit names without fuzzy guesses", async () => {
  const m = await real();
  for (const [toolName, args, source, label, expected] of [
    ["web_search", { query: "hello" }, "npm:pi-web-access", "Web Search", "Web"],
    ["fetch_content", {}, "npm:pi-web-access@0.27.0", "Fetch", "Web"],
    ["source_check", {}, "npm:pi-web-access", "Check", "Web"],
    ["get_search_content", {}, "npm:pi-web-access", "Content", "Web"],
    ["renamed_fetch", {}, "npm:pi-web-access", "Fetch", "Web"],
    ["renamed_fetch", {}, "npm:pi-web-access-spoof", "Fetch", "Tool"],
    ["mcp", { tool: "exa/web_search_exa" }, "npm:pi-mcp-adapter", "MCP", "Web"],
    ["mcp", { tool: "exa_web_fetch_exa" }, "npm:pi-mcp-adapter@2.32.1", "MCP", "Web"],
    ["mcp__exa", { tool: "web_search_exa" }, "npm:pi-mcp-adapter", "MCP: exa", "Web"],
    ["exa_web_search_exa", {}, "npm:pi-mcp-adapter", "MCP: web_search_exa", "Web"],
    ["custom_prefix_fetch", {}, "npm:pi-mcp-adapter", "MCP: web_fetch_exa", "Web"],
    ["mcp", { search: "web search tools" }, "npm:pi-mcp-adapter", "MCP", "MCP"],
    ["mcp", { describe: "exa/web_search_exa" }, "npm:pi-mcp-adapter", "MCP", "MCP"],
    ["mcp", { action: "auth-start", tool: "exa/web_search_exa" }, "npm:pi-mcp-adapter", "MCP", "MCP"],
    ["mcp", { tool: "railway/search_projects" }, "npm:pi-mcp-adapter", "MCP", "Tool"],
    ["mcp__railway", { tool: "search_projects" }, "npm:pi-mcp-adapter", "MCP: railway", "Tool"],
    ["mcpScript", { code: 'await tools.web_search_exa({query: "test"})' }, "npm:pi-mcp-adapter", "MCP Script", "Batch"],
    ["database_search", {}, "npm:pi-mcp-adapter", "MCP: search", "Tool"],
    ["Agent", {}, "project-extension", "Agent", "Agent"],
    ["get_subagent_result", {}, "project-extension", "Agent result", "Agent"],
    ["SubagentWorkflow", {}, "project-extension", "Workflow", "Flow"],
    ["ask_user_question", {}, "project-extension", "Ask", "Ask"],
    ["todo", {}, "project-extension", "Todo", "Tasks"],
    ["intercom", {}, "npm:pi-intercom", "Intercom", "Chat"],
    ["create_goal", {}, "project-extension", "Goal", "Goal"],
    ["powershell", { command: "Get-Date" }, "builtin", "PowerShell", "Run"],
    ["constructor", {}, "project-extension", "Web", "Tool"],
  ] as const) {
    const component = { toolName, args, toolDefinition: { label, configsTranscriptSource: source } };
    const line = m.tui.stripTerminalSequences(m.actionLines(component, 120)[0]);
    expect(line, toolName).toMatch(new RegExp(`^○ \\S+ ${expected}\\s+`));
  }
});

realTest("invocation rows unwrap MCP arguments, redact credentials and expand beyond the preview", async () => {
  const m = await real();
  const definition = { configsTranscriptSource: "npm:pi-mcp-adapter", label: "MCP" };
  const render = (component: any, width = 180) => m.actionLines(component, width).map(m.tui.stripTerminalSequences).join("\n");
  const call = { toolName: "mcp", toolDefinition: definition,
    args: { tool: "exa/web_search_exa", args: { query: "界 hello", numResults: 5 } } };
  const objectCall = render(call);
  expect(objectCall).toContain('Web    exa/web_search_exa(query="界 hello", numResults=5)');
  expect(render({ ...call, args: { ...call.args, args: JSON.stringify(call.args.args) } })).toBe(objectCall);
  expect(render({ ...call, toolName: "mcp__exa", toolDefinition: { ...definition, label: "MCP: exa" },
    args: { tool: "web_search_exa", args: call.args.args } })).toBe(objectCall);
  expect(render({ ...call, args: { tool: "unknown/operation", args: { id: 7 } } }))
    .toContain("Tool   unknown/operation(id=7)");
  expect(render({ ...call, args: { tool: "unknown/operation", args: '{"apiKey":"SECRET"' } }))
    .toContain("[invalid JSON arguments]");

  const secrets = {
    apiKey: "SECRET_API", nested: { password: "SECRET_PASSWORD", access_token: "SECRET_TOKEN" },
    headers: { Authorization: "SECRET_HEADER" }, env: { OPENAI_API_KEY: "SECRET_ENV" },
    url: "https://user:SECRET_PASS@example.com/page?query=visible&api_key=SECRET_QUERY#access_token=SECRET_FRAGMENT",
    redirectUrl: "https://localhost/callback?code=SECRET_CODE&state=SECRET_STATE",
    query: "visible\n\x1b[31mvalue\x1b[0m\x1b]0;injected-title\x07",
    count: 0, flag: false, nothing: null, max_tokens: 42,
  };
  const secretCall = { ...call, args: { tool: "unknown/operation", args: secrets }, expanded: true };
  const before = JSON.stringify(secretCall);
  const sanitized = render(secretCall);
  expect(sanitized).not.toContain("SECRET");
  expect(sanitized).not.toContain("injected-title");
  expect(sanitized).toContain("[redacted]");
  expect(sanitized).toContain("max_tokens=42");
  expect(sanitized).toContain("count=0");
  expect(sanitized).toContain("flag=false");
  expect(sanitized).toContain("nothing=null");
  expect(JSON.stringify(secretCall)).toBe(before);

  const longCall = { toolName: "fetch_content", args: { url: "https://example.com/", prompt: "界 long ".repeat(80) + "TAIL_ARGUMENT" } };
  expect(render(longCall, 80)).not.toContain("TAIL_ARGUMENT");
  expect(render({ ...longCall, expanded: true }, 80)).toContain("TAIL_ARGUMENT");
  for (const expanded of [false, true]) {
    for (const width of [120, 80, 40, 12, 4, 1]) {
      expect(m.actionLines({ ...longCall, expanded }, width).every((line: string) => m.tui.visibleWidth(line) <= width)).toBe(true);
    }
  }
  const longUser = "PRIVATE_URL_USER".repeat(100);
  expect(render({ toolName: "fetch_content", args: { url: `https://${longUser}@example.com/path` } }, 40))
    .not.toContain("PRIVATE_URL_USER");
  const cyclic: any = { value: "hello" };
  cyclic.self = cyclic;
  expect(render({ toolName: "custom", args: cyclic })).toContain("[circular]");
  expect(render({ toolName: "custom", args: { data: "x".repeat(100_000) }, expanded: true }))
    .toMatch(/arguments\s+truncated/);
  const deep: any = {};
  let tip = deep;
  for (let i = 0; i < 30; i++) tip = tip.next = {};
  expect(render({ toolName: "custom", args: deep, expanded: true })).toMatch(/arguments\s+truncated/);
});

realTest("web and MCP states preserve pending, partial, failures, approval hints and history", async () => {
  const m = await real();
  const cases = [
    { name: "fetch_content", details: { error: "Fetch failed" }, status: "×", notice: "Fetch failed" },
    { name: "fetch_content", details: { urlCount: 2, successful: 0 }, status: "×", notice: "2 of 2 URLs failed" },
    { name: "fetch_content", details: { urlCount: 2, successful: 1 }, status: "!", notice: "1 of 2 URLs failed" },
    { name: "web_search", details: { queryCount: 2, successfulQueries: 0 }, status: "×", notice: "2 of 2 queries failed" },
    { name: "web_search", details: { queryCount: 2, successfulQueries: 1 }, status: "!", notice: "1 of 2 queries failed" },
    { name: "web_search", details: { queryCount: 1, successfulQueries: 1, totalResults: 0 }, status: "✓" },
    { name: "source_check", details: { artifact: { errors: [{ query: "a", error: "timeout" }] } }, status: "!", notice: "search errors" },
    { name: "get_search_content", details: { error: "Not found" }, status: "×", notice: "Not found" },
    { name: "mcp", details: { error: "tool_error", message: "Remote failure" }, status: "×", notice: "Remote failure" },
    { name: "mcp__exa", details: { error: "call_failed" }, status: "×", notice: "DETAIL_BODY" },
    { name: "exa_web_search_exa", details: { error: "input_required_needs_ui", message: "Open a UI" }, status: "×", notice: "Open a UI" },
    { name: "mcp", details: { error: "auth_required", message: "Log in first" }, status: "!", notice: "Log in first" },
    { name: "mcp", details: { error: "unknown_tool", message: "Find the correct tool" }, status: "!", notice: "Find the correct tool" },
    { name: "mcpScript", details: { mode: "script", error: "timeout", message: "Script timed out" }, status: "×", notice: "Script timed out" },
    { name: "mcpScript", details: { mode: "script", calls: [{ ok: true }, { ok: false, error: "call_failed" }] }, status: "!", notice: "1 of 2 MCP operations failed" },
    { name: "mcpScript", details: { mode: "script", calls: [{ ok: true }] }, status: "✓" },
    { name: "custom", details: { error: "domain data, not a tool failure" }, status: "✓" },
    { name: "custom", details: {}, isError: true, status: "×", notice: "DETAIL_BODY" },
  ];
  const definition = (name: string) => ({
    configsTranscriptSource: name === "custom" ? "npm:unrelated"
      : name.startsWith("mcp") || name.startsWith("exa_") ? "npm:pi-mcp-adapter@2.32.1" : "npm:pi-web-access@0.27.0",
    ...(name === "mcp__exa" ? { label: "MCP: exa" } : name === "exa_web_search_exa" ? { label: "MCP: web_search_exa" } : {}),
  });
  const app = host(m);
  app.getRegisteredToolDefinition = definition;
  const message = assistant(cases.map((item, i) => toolCall(`state-${i}`, item.name, { tool: "web_search_exa", args: { query: `q-${i}` } })));
  const results = cases.map((item, i) => ({ ...result(`state-${i}`, item.name, "DETAIL_BODY", item.isError), details: item.details }));
  const original = JSON.stringify([message, results]);
  await app.handleEvent({ type: "message_start", message });
  await app.handleEvent({ type: "message_update", message });
  await app.handleEvent({ type: "message_end", message });
  for (const [i, item] of [...cases.entries()].reverse()) {
    const id = `state-${i}`;
    const tool = app.pendingTools.get(id);
    expect(m.tui.stripTerminalSequences(m.actionLines(tool, 140)[0])).toStartWith("○");
    await app.handleEvent({ type: "tool_execution_start", toolCallId: id, toolName: item.name, args: {} });
    await app.handleEvent({ type: "tool_execution_update", toolCallId: id, toolName: item.name, partialResult: results[i] });
    expect(m.tui.stripTerminalSequences(m.actionLines(tool, 140)[0])).toStartWith("◌");
    await app.handleEvent({ type: "tool_execution_end", toolCallId: id, result: results[i], isError: results[i].isError });
    app.sessionManager.appendMessage(results[i]);
    const rows = m.actionLines(tool, 140).map(m.tui.stripTerminalSequences);
    expect(rows[0]).toStartWith(item.status);
    if (item.notice) expect(rows.join("\n")).toContain(item.notice);
  }
  const replay = host(m, app.sessionManager);
  replay.getRegisteredToolDefinition = definition;
  replay.renderSessionItems([message, ...results]);
  expect(transcript(m, app, 140)).toBe(transcript(m, replay, 140));
  expect(transcript(m, app, 140)).toContain(`${cases.length} actions`);
  expect(JSON.stringify([message, results])).toBe(original);

  const waiting = new m.ToolExecutionComponent("web_search", "approval", {}, {}, definition("web_search"), app.ui, temp);
  waiting.updateResult({ content: [{ type: "text", text: "Open http://localhost:1234 for approval" }], details: { phase: "curator-fallback" } }, true);
  expect(m.actionLines(waiting, 100).map(m.tui.stripTerminalSequences).join("\n"))
    .toContain("Waiting for browser approval; expand for details.");
  waiting.setExpanded(true);
  expect(waiting.render(100).map(m.tui.stripTerminalSequences).join("\n")).toContain("http://localhost:1234");
});

realTest("unchanged tool rows reuse formatting and only changed calls rebuild", async () => {
  const m = await real();
  const app = host(m);
  const reads = Array(20).fill(0);
  const queries = reads.map((_, i) => `query-${i}`);
  const tools = reads.map((_, i) => {
    // Count actual argument formatting rather than asserting machine-dependent timing.
    const args = { get query() { reads[i]++; return queries[i]; } };
    const tool = new m.ToolExecutionComponent("custom", `cache-${i}`, args, {}, undefined, app.ui, temp);
    tool.setArgsComplete();
    tool.updateResult(result(`cache-${i}`, "custom", "done"));
    app.chatContainer.addChild(tool);
    return tool;
  });
  reads.fill(0);
  const first = app.chatContainer.render(120);
  const formatted = [...reads];
  expect(formatted.every(count => count > 0)).toBe(true);
  for (let i = 0; i < 10; i++) expect(app.chatContainer.render(120)).toEqual(first);
  expect(reads).toEqual(formatted);

  // Updates can reuse the same arguments object; reference equality is insufficient.
  queries[0] = "updated-query";
  tools[0].updateArgs(tools[0].args);
  const beforeUpdateRender = [...reads];
  expect(transcript(m, app, 120)).toContain("updated-query");
  expect(reads[0]).toBeGreaterThan(beforeUpdateRender[0]);
  expect(reads.slice(1)).toEqual(formatted.slice(1));

  const beforeInvalidation = reads[1];
  tools[1].getRenderContext(undefined).invalidate();
  app.chatContainer.render(120);
  expect(reads[1]).toBeGreaterThan(beforeInvalidation);
  const afterInvalidation = [...reads];
  app.chatContainer.render(120);
  expect(reads).toEqual(afterInvalidation);

  app.chatContainer.clear();
  const replay = new m.ToolExecutionComponent("custom", "cache-0", { query: "replayed-query" }, {}, undefined, app.ui, temp);
  app.chatContainer.addChild(replay);
  expect(transcript(m, app, 120)).toContain("replayed-query");
  expect(transcript(m, app, 120)).not.toContain("updated-query");
});

realTest("cached tool rows preserve updates, timing, expansion, resizing and theme invalidation", async () => {
  const m = await real();
  const app = host(m);
  const tool = new m.ToolExecutionComponent("web_search", "cache-state", { query: "before" }, {},
    { configsTranscriptSource: "npm:pi-web-access" }, app.ui, temp);
  app.chatContainer.addChild(tool);
  // Compare cached rows with the pure formatter at the container's inner width.
  const frame = (width = 120) => {
    const lines = app.chatContainer.render(width);
    const padding = width < 80 ? m.transcriptPadding(1, width) : 3;
    const rows = m.actionLines(tool, width - padding - 3);
    for (const row of rows) expect(lines.some((line: string) => line.endsWith(row))).toBe(true);
    expect(lines.every((line: string) => m.tui.visibleWidth(line) <= width)).toBe(true);
    expect(app.chatContainer.render(width)).toEqual(lines);
    return lines.map(m.tui.stripTerminalSequences).join("\n");
  };
  expect(frame()).toContain("○");
  tool.args.query = "after";
  tool.updateArgs(tool.args);
  expect(frame()).toContain('query="after"');
  tool.setArgsComplete();
  frame();
  tool.markExecutionStarted();
  expect(frame()).toContain("◌");
  const output = { content: [{ type: "text", text: "NATIVE_DETAILS" }], details: { phase: "curating", error: "" } };
  tool.updateResult(output, true);
  expect(frame()).toContain("Waiting for browser approval");
  output.details.phase = "complete";
  tool.updateResult(output);
  expect(frame()).toContain("✓");
  expect(frame()).not.toContain("Waiting for browser approval");
  tool.transcriptDurationMs = 1200; // Timing may be assigned outside updateDisplay().
  expect(frame()).toContain("1.2s");
  output.details.error = "Fetch failed";
  tool.updateResult(output); // In-place metadata changes must invalidate too.
  expect(frame()).toContain("×");
  expect(frame()).toContain("Fetch failed");

  tool.updateArgs({ query: "long query ".repeat(30) + "TAIL_ARGUMENT" });
  expect(frame()).not.toContain("TAIL_ARGUMENT");
  tool.setExpanded(true);
  expect(frame()).toContain("TAIL_ARGUMENT");
  expect(frame()).toContain("NATIVE_DETAILS");
  tool.setExpanded(false);
  const wide = frame();
  frame(40);
  expect(frame()).toBe(wide);

  const beforeTheme = app.chatContainer.render(120);
  try {
    m.colors.setThemeInstance(m.colors.loadThemeFromPath(fileURLToPath(new URL("../themes/woody.json", import.meta.url)), "truecolor"));
    // Match InteractiveMode's onThemeChange callback: invalidate before rendering.
    // Pi's exported theme is a stable proxy, not the replaced Theme instance.
    app.chatContainer.invalidate();
    frame();
    expect(app.chatContainer.render(120)).not.toEqual(beforeTheme);
  } finally {
    m.colors.setThemeInstance(m.colors.loadThemeFromPath(fileURLToPath(new URL("../themes/osaka-jade.json", import.meta.url)), "truecolor"));
    app.chatContainer.invalidate();
  }
  expect(app.chatContainer.render(120)).toEqual(beforeTheme);
});

realTest("action labels alone are bold at wide and narrow widths", async () => {
  const m = await real();
  const theme = m.colors.theme;
  for (const [toolName, label] of [
    ["read", "Read"], ["grep", "Search"], ["edit", "Edit"], ["write", "Write"],
    ["bash", "Run"], ["find", "Find"], ["ls", "List"], ["custom", "Tool"],
  ]) {
    for (const width of [40, 90]) {
      const line = m.actionLines({ toolName, args: { path: "target.ts", command: "target.ts" } }, width)[0];
      const labelText = width < 60 ? label : label.padEnd(6);
      expect(line).toContain("\x1b[1m");
      expect(line).toContain(theme.bold(theme.fg("muted", labelText)));
      const textAnsi = theme.fg("text", "TARGET").split("TARGET")[0];
      expect(line).toContain(" " + textAnsi + (toolName === "custom" ? "custom(" : "target.ts"));
      expect(m.tui.visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  }
});

realTest("single actions keep status and alignment when a group grows or shrinks", async () => {
  const m = await real();
  const app = host(m);
  let height = 40;
  app.chatContainer = new m.TranscriptContainer(() => 1, () => height);
  const first = new m.ToolExecutionComponent("read", "first", { path: "first.ts" }, {}, undefined, app.ui, temp);
  const second = new m.ToolExecutionComponent("grep", "second", { pattern: "pageScroll", path: "/opt/homebrew" }, {}, undefined, app.ui, temp);
  app.chatContainer.addChild(first);
  expect(transcript(m, app)).toContain("\n      ○ □ Read");
  first.markExecutionStarted();
  expect(transcript(m, app)).toContain("\n      ◌ □ Read");
  first.updateResult(result("first", "read", "file contents"));
  first.transcriptDurationMs = 50;
  expect(transcript(m, app)).toContain("\n      ✓ □ Read");

  for (const rows of [40, 12]) {
    height = rows;
    for (const width of [120, 79, 40, 20, 12, 8, 6, 4]) {
      const single = app.chatContainer.render(width);
      const singleText = single.map(m.tui.stripTerminalSequences).join("\n");
      expect(singleText).not.toContain("1 action");
      expect(singleText).not.toMatch(/[─├╰]/);
      app.chatContainer.addChild(second);
      const grouped = app.chatContainer.render(width);
      expect([...single, ...grouped].every((line: string) => m.tui.visibleWidth(line) <= width)).toBe(true);
      if (width >= 40) {
        const plain = single.map(m.tui.stripTerminalSequences);
        const group = grouped.map(m.tui.stripTerminalSequences);
        expect(group.some((line: string) => line.trim() === "2 actions")).toBe(true);
        expect(plain.find((line: string) => line.includes("Read"))).toContain("<0.1s");
        expect(plain.find((line: string) => line.includes("Read"))).toBe(
          group.find((line: string) => line.includes("Read")).replace("├─ ", "   "));
        expect(group.find((line: string) => line.includes("Search"))).toContain("╰─ ○ ◎ Search");
      }
      app.chatContainer.removeChild(second);
      expect(app.chatContainer.render(width)).toEqual(single);
    }
  }
  expect(app.chatContainer.children).toEqual([first]);
});

realTest("transcript changes only singleton framing and label weight across error-row combinations", async () => {
  const m = await real();
  const previousPath = join(fixture, "dist/modes/interactive/components/transcript-previous.js");
  writeFileSync(previousPath, readFileSync(new URL("../patches/payloads/host/legacy/transcript_before_single_action.js.inc", import.meta.url), "utf8"));
  const previous = await import(pathToFileURL(previousPath).href);
  for (const count of [1, 2, 3]) {
    for (let failed = -1; failed < count; failed++) {
      const current = new m.TranscriptContainer();
      const old = new previous.TranscriptContainer();
      for (let index = 0; index < count; index++) {
        const component = () => ({
          transcriptRole: "tool", toolName: "read", args: { path: "src/界.ts" }, argsComplete: true,
          result: { isError: index === failed, content: [{ type: "text", text: "Permission denied" }] },
          render: () => ["native"], invalidate() {},
        });
        current.addChild(component());
        old.addChild(component());
      }
      for (const width of [80, 90, 120, 160]) {
        const theme = m.colors.theme;
        const withoutBold = current.render(width).map((line: string) =>
          line.replace(theme.bold(theme.fg("muted", "Read  ")), theme.fg("muted", "Read  ")));
        const expected = old.render(width)
          .filter((line: string) => m.tui.stripTerminalSequences(line).trim() !== "1 action")
          .map((line: string) => count === 1 ? line.replace("╰─ ", "   ") : line);
        expect(withoutBold).toEqual(expected);
      }
    }
  }
});

realTest("compact transcript reclaims gutters and blank rows without losing content or expansion", async () => {
  const m = await real();
  const app = host(m);
  let rows = 40;
  app.chatContainer = new m.TranscriptContainer(() => 1, () => rows);
  app.renderSessionItems([
    { role: "user", content: "Inspect 界.ts", timestamp },
    assistant([toolCall("r", "read", { path: "界.ts" })]),
    result("r", "read", "Permission denied\nFull native error details", true),
    assistant([{ type: "text", text: "The file could not be read." }]),
  ]);
  const children = [...app.chatContainer.children];
  const large = app.chatContainer.render(120);
  rows = 12;
  const short = app.chatContainer.render(120);
  const meaningful = (lines: string[]) => lines.map(m.tui.stripTerminalSequences).filter((line: string) => line.trim());
  expect(short.length).toBeLessThan(large.length);
  expect(meaningful(short)).toEqual(meaningful(large));

  for (const [width, height] of [[40, 12], [50, 16], [60, 20], [70, 12], [120, 12], [40, 40], [120, 40]]) {
    rows = height;
    const rendered = app.chatContainer.render(width);
    const text = rendered.map(m.tui.stripTerminalSequences).join("\n");
    expect(text).toContain("Permission denied");
    expect(text).toContain("界.ts");
    expect(rendered.every((line: string) => m.tui.visibleWidth(line) <= width)).toBe(true);
    expect(app.chatContainer.children).toEqual(children);
    for (const child of children.filter((c: any) => c.transcriptRole === "pi" || c.transcriptRole === "user")) {
      expect(child.outputPad).toBe(width < 80 ? 1 : 3);
    }
  }
  expect(app.chatContainer.render(120)).toEqual(large);
  const tool = children.find((child: any) => child.transcriptRole === "tool");
  tool.setExpanded(true);
  rows = 12;
  expect(transcript(m, app, 40)).toContain("Full native error details");
  expect(tool.expanded).toBe(true);
});
