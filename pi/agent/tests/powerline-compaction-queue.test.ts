import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkProcess, copyPackageSources, describePatch, temporaryDirectory } from "./support/patch-fixtures";
import { nativeSuite } from "./support/native-suite";

const sdk = process.env.PI_SDK_ROOT;
const installed = process.env.PI_POWERLINE_ROOT ?? join(homedir(), ".pi/agent/git/github.com/nicobailon/pi-powerline-footer");
const { unitTest: test, nativeTest } = nativeSuite(import.meta.path, !!sdk && existsSync(installed));
const temp = temporaryDirectory("powerline-compaction-queue-");
const patcher = new URL("../patches/powerline-compaction-queue.py", import.meta.url).pathname;
const { ORIGINAL, PATCHED, MARKER } = describePatch<{
  ORIGINAL: string; PATCHED: string; MARKER: string;
}>(patcher, "{key:m[key] for key in ['ORIGINAL','PATCHED','MARKER']}");
const runPatch = (home: string) => Bun.spawnSync(["python3", "-B", patcher], {
  env: { ...process.env, HOME: home },
});

test("Powerline queue patch backs up originals, replays, and refuses changed schedulers", () => {
  const home = join(temp, "guards");
  const target = join(home, ".pi/agent/git/github.com/nicobailon/pi-powerline-footer/index.ts");
  mkdirSync(dirname(target), { recursive: true });
  const original = ORIGINAL + "\n// preserve unrelated changes\n";
  writeFileSync(target, original);
  expect(runPatch(home).exitCode).toBe(0);
  const patched = readFileSync(target, "utf8");
  expect(patched).toBe(original.replace(ORIGINAL, PATCHED));
  const backups = join(home, ".config/theme-backups");
  const names = readdirSync(backups);
  expect(names).toHaveLength(1);
  expect(readFileSync(join(backups, names[0], "index.ts"), "utf8")).toBe(original);
  expect(runPatch(home).exitCode).toBe(0);
  expect(readFileSync(target, "utf8")).toBe(patched);

  for (const source of [
    ORIGINAL.replace("}, 50)", "}, 51)"), ORIGINAL + MARKER,
    PATCHED.replace("!ctx.isIdle()", "ctx.isIdle()"), ORIGINAL + ORIGINAL,
    PATCHED + ORIGINAL, PATCHED + PATCHED,
  ]) {
    writeFileSync(target, source);
    expect(runPatch(home).exitCode).not.toBe(0);
    expect(readFileSync(target, "utf8")).toBe(source);
  }
  expect(readdirSync(backups)).toEqual(names);
  expect(runPatch(join(temp, "absent")).exitCode).toBe(0);
});

nativeTest("Powerline editor holds post-compaction input until all completion hooks finish", async () => {
  // Load the entire real extension, but isolate its settings, history and queue.
  const home = join(temp, "home");
  const agentDir = join(home, ".pi/agent");
  const powerline = join(agentDir, "git/github.com/nicobailon/pi-powerline-footer");
  copyPackageSources(installed, powerline);
  checkProcess(runPatch(home));
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ powerline: { welcome: false } }));
  const previousHome = process.env.HOME;
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.HOME = home;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const load = (path: string) => import(pathToFileURL(join(sdk!, path)).href);
  const { Agent } = await load("node_modules/@earendil-works/pi-agent-core/dist/agent.js");
  const { createAssistantMessageEventStream } = await load("node_modules/@earendil-works/pi-ai/dist/index.js");
  const { AgentSession } = await load("dist/core/agent-session.js");
  const { SessionManager } = await load("dist/core/session-manager.js");
  const { SettingsManager } = await load("dist/core/settings-manager.js");
  const { loadExtensions, loadExtensionFromFactory } = await load("dist/core/extensions/loader.js");
  const { createEventBus } = await load("dist/core/event-bus.js");
  const { KeybindingsManager } = await load("dist/core/keybindings.js");
  const events = createEventBus();
  let entered = Promise.withResolvers<void>();
  let release = Promise.withResolvers<void>();
  let finished = Promise.withResolvers<void>();
  let delivered = Promise.withResolvers<void>();
  let editor: any;
  let pending: string[] = [];

  async function loadResources() {
    const resources = await loadExtensions([join(powerline, "index.ts")], home, events);
    expect(resources.errors).toEqual([]);
    resources.extensions.push(await loadExtensionFromFactory((pi: any) => {
      pi.on("session_before_compact", (event: any) => {
        // Actual custom editor Enter interception, not Pi's native queue.
        for (const text of pending) {
          editor.setText(text);
          editor.handleInput("\r");
        }
        return { compaction: {
          summary: "Test summary", firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
        } };
      });
      pi.on("session_compact", async () => {
        entered.resolve();
        await release.promise;
      });
    }, home, events, resources.runtime, "<slow-completion-hook>"));
    return resources;
  }

  let resources = await loadResources();
  const requests: string[] = [];
  const model = {
    id: "fake", name: "fake", api: "fake", provider: "fake", baseUrl: "",
    reasoning: false, input: ["text"], contextWindow: 10000, maxTokens: 100,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const agent = new Agent({
    initialState: { model, tools: [], systemPrompt: "Test" },
    streamFn: (_model: unknown, context: any) => {
      const user = context.messages.findLast((message: any) => message.role === "user");
      requests.push(user.content[0].text);
      const message = {
        role: "assistant", content: [{ type: "text", text: "Finished" }],
        api: "fake", provider: "fake", model: "fake", timestamp: Date.now(), stopReason: "stop",
        usage: {
          input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    },
  });
  const session = new AgentSession({
    agent, sessionManager: SessionManager.inMemory(home), cwd: home, baseToolsOverride: {},
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false, keepRecentTokens: 1 } }),
    modelRuntime: { hasConfiguredAuth: () => true, getAuth: async () => undefined },
    resourceLoader: {
      getExtensions: () => resources, getSkills: () => ({ skills: [] }),
      getPrompts: () => ({ prompts: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => "Test", getAppendSystemPrompt: () => [],
      reload: async () => { resources = await loadResources(); },
    },
  });
  const errors: unknown[] = [];
  const notifications: string[] = [];
  const tui = { terminal: { rows: 30, columns: 100 }, requestRender() {} };
  const keybindings = new KeybindingsManager();
  const ui = {
    theme: { fg: (_role: string, text: string) => text, bold: (text: string) => text },
    notify: (message: string) => notifications.push(message),
    setStatus() {}, setWidget() {}, setFooter() {}, setHeader() {}, setWorkingMessage() {},
    getEditorComponent: () => undefined,
    setEditorComponent: (factory: any) => {
      editor = factory(tui, { borderColor: (text: string) => text, selectList: {} }, keybindings);
    },
    getEditorText: () => editor.getText(), setEditorText: (text: string) => editor.setText(text),
  };
  session.subscribe((event: any) => {
    if (event.type === "compaction_end") finished.resolve();
    if (event.type === "agent_settled" && requests.includes(pending.at(-1)!)) delivered.resolve();
  });
  const inbox = () => readFileSync(join(agentDir, "powerline-footer/inbox.jsonl"), "utf8")
    .trim().split("\n").map(line => JSON.parse(line));

  try {
    await session.bindExtensions({ uiContext: ui, mode: "tui", onError: (error: unknown) => errors.push(error) });
    expect(errors).toEqual([]);
    await session.prompt("Initial request");
    for (const reload of [false, true]) {
      if (reload) await session.reload();
      entered = Promise.withResolvers<void>();
      release = Promise.withResolvers<void>();
      finished = Promise.withResolvers<void>();
      delivered = Promise.withResolvers<void>();
      pending = reload ? ["after reload", "second queued message"] : ["test"];
      const before = [...requests];
      editor.setText("/compact");
      editor.handleInput("\r");
      await entered.promise;
      // Hold the later hook past Powerline's 50 ms timer (including retries).
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(session.isIdle).toBe(false);
      expect(requests).toEqual(before);
      expect(errors).toEqual([]);
      expect(notifications.filter(text => text.startsWith("Sent queued item"))).toHaveLength(before.length - 1);
      expect(inbox().filter(item => item.status !== "sent").map(item => [item.text, item.status]))
        .toEqual(pending.map(text => [text, "queued"]));

      release.resolve();
      await finished.promise;
      await delivered.promise;
      expect(requests).toEqual([...before, ...pending]);
      expect(inbox().every(item => item.status === "sent")).toBe(true);
      expect(notifications.filter(text => text.startsWith("Sent queued item"))).toHaveLength(requests.length - 1);
      expect(errors).toEqual([]);
      expect(session.isIdle).toBe(true);
    }
  } finally {
    release.resolve();
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});
