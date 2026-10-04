import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applySdkPatches, checkProcess, copyPackageSources, copySdk, describePatch, temporaryDirectory } from "./support/patch_fixtures";
import { nativeSuite } from "./support/native_suite";

const patcher = fileURLToPath(new URL("../patches/intercom_ui.py", import.meta.url));
const generator = fileURLToPath(new URL("./support/intercom_fixture.py", import.meta.url));
const description = describePatch<{ edits: Record<string, [string, string, number][]>; original: string; module: string; previous: string }>(
  patcher, "{'edits': m['EDITS'], 'original': m['ORIGINAL_MODULE'], 'module': m['MODULE'], 'previous': m['_PREVIOUS_MODULE_SOURCE']}");
const previousHeading = readFileSync(new URL("../patches/payloads/intercom/legacy/inline_message_before_tool_row.ts.inc", import.meta.url), "utf8");
const previousToolRow = readFileSync(new URL("../patches/payloads/intercom/legacy/inline_message_before_chat_icon.ts.inc", import.meta.url), "utf8");
const source = process.env.PI_INTERCOM_ROOT ?? join(homedir(), ".pi/agent/npm/node_modules/pi-intercom");
const sdk = process.env.PI_SDK_ROOT;
const temp = temporaryDirectory("intercom-ui-");
const { unitTest: test, nativeTest: realTest } = nativeSuite(import.meta.path, !!sdk && existsSync(source));
const run = (root: string) => Bun.spawnSync(["python3", "-B", patcher], {
  env: { ...process.env, HOME: root, PI_INTERCOM_ROOT: root },
});

function sandbox(name: string) {
  const root = join(temp, name);
  mkdirSync(join(root, "ui"), { recursive: true });
  writeFileSync(join(root, "package.json"), '{"name":"pi-intercom","version":"0.13.0"}');
  writeFileSync(join(root, "index.ts"), description.edits["index.ts"].map(([old]) => old).join("\n") + "\n// unrelated delivery code\n");
  writeFileSync(join(root, description.module), description.original);
  return root;
}

function contents(root: string) {
  return Object.fromEntries(["index.ts", description.module].map(file => [file, readFileSync(join(root, file), "utf8")]));
}

test("Intercom validates both files before writing, backs up exact bytes and is idempotent", () => {
  const root = sandbox("valid");
  const before = contents(root);
  checkProcess(run(root));
  const after = contents(root);
  expect(after["index.ts"]).toContain("// unrelated delivery code");
  const backupRoot = join(root, ".config/theme-backups");
  const backups = readdirSync(backupRoot);
  expect(backups).toHaveLength(1);
  for (const [name, content] of Object.entries(before)) {
    expect(readFileSync(join(backupRoot, backups[0], name), "utf8")).toBe(content);
  }
  checkProcess(run(root));
  expect(contents(root)).toEqual(after);
  expect(readdirSync(backupRoot)).toEqual(backups);
});

for (const [name, previous] of [["expanded-body", description.previous], ["sender-heading", previousHeading], ["intercom-label", previousToolRow]]) {
  test(`the previous ${name} renderer migrates exactly and rejects local edits`, () => {
    const root = sandbox(`previous-${name}`);
    checkProcess(run(root));
    const current = contents(root);
    writeFileSync(join(root, description.module), previous);
    const backupRoot = join(root, ".config/theme-backups");
    const beforeBackups = readdirSync(backupRoot);

    checkProcess(run(root));
    expect(contents(root)).toEqual(current);
    const added = readdirSync(backupRoot).filter(name => !beforeBackups.includes(name));
    expect(added).toHaveLength(1);
    expect(readFileSync(join(backupRoot, added[0], description.module), "utf8")).toBe(previous);
    checkProcess(run(root));
    expect(contents(root)).toEqual(current);

    writeFileSync(join(root, description.module), previous + "\n// locally modified");
    const edited = contents(root);
    const backups = readdirSync(backupRoot);
    expect(run(root).exitCode).not.toBe(0);
    expect(contents(root)).toEqual(edited);
    expect(readdirSync(backupRoot)).toEqual(backups);
  });
}

test("Intercom rejects changed versions, owners, modules and partial/duplicate registrations without writes", () => {
  const [old, patched] = description.edits["index.ts"][0];
  for (const state of ["version", "owner", "module", "partial-index", "partial-module", "duplicate-old", "duplicate-new", "mixed"]) {
    const root = sandbox(state);
    if (state === "version" || state === "owner") {
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: state === "owner" ? "imposter" : "pi-intercom", version: state === "version" ? "0.13.1" : "0.13.0" }));
    } else if (state === "module") writeFileSync(join(root, description.module), description.original + "\n// modified");
    else if (state === "partial-index") writeFileSync(join(root, "index.ts"), patched);
    else if (state === "duplicate-old") writeFileSync(join(root, "index.ts"), old + old);
    else {
      checkProcess(run(root));
      if (state === "partial-module") writeFileSync(join(root, "index.ts"), old);
      else writeFileSync(join(root, "index.ts"), patched + (state === "mixed" ? old : patched));
    }
    const before = contents(root);
    const backup = join(root, ".config/theme-backups");
    const backups = existsSync(backup) ? readdirSync(backup) : [];
    expect(run(root).exitCode).not.toBe(0);
    expect(contents(root)).toEqual(before);
    expect(existsSync(backup) ? readdirSync(backup) : []).toEqual(backups);
  }
  expect(run(join(temp, "missing")).exitCode).toBe(0);
});

let loaded: ReturnType<typeof loadReal> | undefined;
function real() {
  return loaded ??= loadReal();
}

async function loadReal() {
  const host = join(temp, "sdk");
  const packageRoot = join(temp, "package");
  copySdk(sdk!, host);
  applySdkPatches(host, ["pi_transcript"]);
  copyPackageSources(source, packageRoot);
  const before = readFileSync(join(packageRoot, "index.ts"), "utf8");
  checkProcess(run(packageRoot));
  const [old, patched] = description.edits["index.ts"][0];
  expect(readFileSync(join(packageRoot, "index.ts"), "utf8")).toBe(before.includes(patched) ? before : before.replace(old, patched));
  // No entrypoint import: only its exact renderer callbacks and pure helpers run.
  for (const [name, target] of [["@earendil-works/pi-coding-agent", host],
    ["@earendil-works/pi-tui", join(host, "node_modules/@earendil-works/pi-tui")],
    ["typebox", join(host, "node_modules/typebox")]]) {
    const link = join(packageRoot, "node_modules", name);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);
  }
  const extracted = join(packageRoot, "fixture.ts");
  checkProcess(Bun.spawnSync(["python3", "-B", generator, packageRoot, extracted]));
  const ui = join(host, "dist/modes/interactive");
  const colors = await import(pathToFileURL(join(ui, "theme/theme.js")).href);
  colors.setThemeInstance(colors.loadThemeFromPath(fileURLToPath(new URL("../themes/osaka-jade.json", import.meta.url)), "truecolor"));
  return {
    ...await import(pathToFileURL(extracted).href),
    ...await import(pathToFileURL(join(ui, "components/custom-message.js")).href),
    ...await import(pathToFileURL(join(ui, "components/tool-execution.js")).href),
    ...await import(pathToFileURL(join(ui, "components/transcript.js")).href),
    ...await import(pathToFileURL(join(ui, "interactive-mode.js")).href),
    colors, tui: await import(pathToFileURL(join(host, "node_modules/@earendil-works/pi-tui/dist/index.js")).href),
  };
}

realTest("real Intercom renderers use shared rows for every owner; expansion, partials, errors and images survive", async () => {
  const m = await real();
  const definition = { name: "intercom", ...m.renderers };
  const result = { content: [{ type: "text", text: "FULL_OUTGOING_DETAIL\nsecond line" }], details: { messageId: "message-identifier", reason: "REASON" }, isError: false };
  const before = JSON.stringify(result);
  for (const [name, owner] of [
    ["intercom", "npm:pi-intercom"], ["intercom", "npm:pi-intercom@0.13.0"],
    ["intercom", "project-extension"], ["intercom", "npm:pi-intercom-spoof"],
    ["intercom", "npm:pi-intercom@0.14.0"], ["contact_supervisor", "npm:pi-intercom"],
  ] as const) {
    const app = Object.create(m.InteractiveMode.prototype);
    app.runtimeHost = { session: { getToolDefinition: () => definition,
      getAllTools: () => [{ name, sourceInfo: { source: owner } }] } };
    const registered = m.InteractiveMode.prototype.getRegisteredToolDefinition.call(app, name);
    const tool = new m.ToolExecutionComponent(name, "call-id", { action: "send", to: "peer", message: "CALL_PREVIEW" },
      { showImages: false }, registered, { requestRender() {} }, temp);
    const container = new m.TranscriptContainer();
    container.addChild(tool);
    const text = (width = 100) => container.render(width).map(m.tui.stripTerminalSequences).join("\n");
    tool.markExecutionStarted();
    tool.updateResult(result, true);
    expect(text()).not.toContain("Intercom working...");
    tool.updateResult(result);
    expect(text()).toContain(name);
    expect(text()).not.toContain("FULL_OUTGOING_DETAIL");
    expect(text()).toContain("CALL_PREVIEW"); // Actual invocation arguments, not a duplicate package card.
    const rows = text().split("\n").filter((line: string) => line.trim());
    expect(rows).toHaveLength(2); // Pi header and the standalone invocation row.
    const heading = name === "intercom" ? "⇄ Chat" : "⌇ Tool";
    expect(rows[1]).toMatch(new RegExp(`^ {6}✓ ${heading}\\s+${name}`));
    tool.setExpanded(true);
    expect(text()).toContain("FULL_OUTGOING_DETAIL");
    expect(text()).toContain("CALL_PREVIEW");
    expect(text()).toContain("Reason: REASON");
    tool.setExpanded(false);
    tool.updateResult({ ...result, isError: true });
    expect(text()).toContain("FULL_OUTGOING_DETAIL"); // Host's error summary stays visible.
    expect(text()).not.toContain("second line");
    for (const width of [100, 40, 12, 4]) {
      expect(container.render(width).every((line: string) => m.tui.visibleWidth(line) <= width)).toBe(true);
    }
    tool.updateResult({ ...result, content: [...result.content, { type: "image", data: "AA==", mimeType: "image/png" }] });
    expect(text()).not.toContain("FULL_OUTGOING_DETAIL");
    tool.setExpanded(true);
    const native = tool.render(100);
    expect(container.render(100).slice(-native.length)).toEqual(native);
    expect(tool.toolCallId).toBe("call-id");
  }
  expect(JSON.stringify(result)).toBe(before);
});

realTest("outgoing chats use ordinary grouped tool rows, not incoming message cards", async () => {
  const m = await real();
  const container = new m.TranscriptContainer();
  const calls = ["peer-a", "peer-b"].map(to => {
    const tool = new m.ToolExecutionComponent("intercom", to, { action: "send", to, message: "hello" },
      {}, m.renderers, { requestRender() {} }, temp);
    tool.markExecutionStarted();
    tool.updateResult({ content: [{ type: "text", text: "NATIVE_EXPANDED_RESULT" }], isError: false });
    tool.transcriptDurationMs = 10;
    container.addChild(tool);
    return tool;
  });
  for (const width of [120, 80, 40, 12, 4, 1]) {
    const lines = container.render(width);
    expect(lines.every((line: string) => m.tui.visibleWidth(line) <= width)).toBe(true);
    if (width >= 80) {
      const text = lines.map(m.tui.stripTerminalSequences).join("\n");
      expect(text).toContain("2 actions");
      expect(text).toMatch(/├─ ✓ ⇄ Chat\s+intercom\(action="send", to="peer-a".*<0\.1s/);
      expect(text).toMatch(/╰─ ✓ ⇄ Chat\s+intercom\(action="send", to="peer-b".*<0\.1s/);
      expect(text).not.toContain("From ");
      expect(text).not.toContain("NATIVE_EXPANDED_RESULT");
    }
  }
  for (const tool of calls) tool.setExpanded(true);
  expect(container.render(120).map(m.tui.stripTerminalSequences).join("\n")).toContain("NATIVE_EXPANDED_RESULT");
});

realTest("incoming messages use shared gutters, live themes and full expansion without altering data", async () => {
  const renderer = await real();
  const { CustomMessageComponent, colors, tui } = renderer;
  const details = {
    from: { id: "sender-full-id", name: "Peer 界", cwd: "/project", model: "faux", pid: 0, startedAt: 0, lastActivity: 0 },
    message: { id: "message-full-id", timestamp: 1750000000000, replyTo: "reply-full-id", expectsReply: true,
      injectedAt: 1750000000010, provenance: { type: "extension_outbox", extensionId: "fixture", extensionName: "Fixture", requestId: "request-id" },
      content: { text: "MESSAGE_PREVIEW " + "long body 界🙂 ".repeat(20), attachments: [{ name: "a.ts", type: "snippet", content: "ATTACHMENT_CONTENT" }] } },
    replyCommand: "REPLY_COMMAND",
  };
  const message = { role: "custom", customType: "intercom_message", content: "UNCHANGED_MODEL_CONTENT", details, timestamp: 1750000000010 };
  const original = JSON.stringify(message);
  const component = new CustomMessageComponent(message, renderer.incomingRenderer);
  const standalone = new renderer.TranscriptContainer(() => 2);
  const run = new renderer.ToolExecutionComponent("bash", "run", { command: "printf example" }, {}, undefined, { requestRender() {} }, temp);
  run.updateResult({ content: [], isError: false });
  standalone.addChild(run);
  for (const themeName of ["osaka-jade", "woody"]) {
    colors.setThemeInstance(colors.loadThemeFromPath(fileURLToPath(new URL(`../themes/${themeName}.json`, import.meta.url)), "truecolor"));
    component.invalidate();
    for (const width of [120, 79, 40, 12, 4, 1]) {
      component.setExpanded(false);
      component.setOutputPad(2);
      const lines = component.render(width);
      const plain = lines.map(tui.stripTerminalSequences).join("\n");
      expect(plain).not.toMatch(/[╭╮╰╯│]/);
      expect(plain).not.toContain("ATTACHMENT_CONTENT");
      expect(plain).not.toContain("REPLY_COMMAND");
      expect(lines.every((line: string) => tui.visibleWidth(line) <= width)).toBe(true);
      const runRow = standalone.render(width).map(tui.stripTerminalSequences).find((line: string) => line.includes("✓"));
      const incomingHeader = lines.find((line: string) => tui.stripTerminalSequences(line).includes("✓")) ?? "";
      const incomingRow = tui.stripTerminalSequences(incomingHeader);
      expect(incomingRow.indexOf("✓")).toBe(runRow.indexOf("✓"));
      if (width > 40) {
        expect(plain).toMatch(/✓ ⇄ Chat\s+From Peer 界/);
        const bodyPad = runRow.indexOf("✓") + 2;
        expect(plain.split("\n").find((line: string) => line.includes("MESSAGE_PREVIEW"))).toStartWith(" ".repeat(bodyPad) + "MESSAGE_PREVIEW");
        expect(incomingHeader).toContain(colors.theme.fg("accent", "⇄"));
        expect(incomingHeader).toContain(colors.theme.bold(colors.theme.fg("muted", "Chat  ")));
        expect(incomingHeader).toContain(colors.theme.fg("text", "From Peer 界"));
      }
      component.setExpanded(true);
      const expanded = component.render(width);
      expect(expanded.every((line: string) => tui.visibleWidth(line) <= width)).toBe(true);
      if (width >= 40) {
        const text = expanded.map(tui.stripTerminalSequences).join("\n");
        for (const detail of ["ATTACHMENT_CONTENT", "REPLY_COMMAND", "sender-full-id", "message-full-id", "reply-full-id", "Via extension: Fixture", "/project"]) expect(text).toContain(detail);
      }
    }
  }
  expect(JSON.stringify(message)).toBe(original);
  expect(renderer.incomingRenderer({ details: undefined }, { expanded: false, outputPad: 1 }, colors.theme)).toBeUndefined();
  // Real delivery supplies formatted bodyText, already containing attachments.
  const suppliedBody = "DISPLAY_BODY\nATTACHMENT_CONTENT";
  const withBody = new CustomMessageComponent({ ...message, details: { ...details, bodyText: suppliedBody } }, renderer.incomingRenderer);
  withBody.setExpanded(true);
  const expanded = withBody.render(120).map(tui.stripTerminalSequences).join("\n");
  expect(expanded).toContain("DISPLAY_BODY");
  expect(expanded.match(/ATTACHMENT_CONTENT/g)).toHaveLength(1);
  expect(message.content).toBe("UNCHANGED_MODEL_CONTENT");
});
