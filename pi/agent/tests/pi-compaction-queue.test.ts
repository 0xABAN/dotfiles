import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applySdkPatches, copySdk, describePatch, temporaryDirectory } from "./support/patch-fixtures";
import { nativeSuite } from "./support/native-suite";

const patcher = fileURLToPath(new URL("../patches/pi-compaction-queue.py", import.meta.url));
const { HOST, ORIGINAL, PATCHED, MARKER } = describePatch<{
  HOST: string; ORIGINAL: string; PATCHED: string; MARKER: string;
}>(patcher, "{key:m[key] for key in ['HOST','ORIGINAL','PATCHED','MARKER']}");
const sdk = process.env.PI_SDK_ROOT;
const temp = temporaryDirectory("pi-compaction-queue-");
const { unitTest: test, nativeTest } = nativeSuite(import.meta.path, !!sdk);
const run = (root: string) => Bun.spawnSync(["python3", "-B", patcher], {
  env: { ...process.env, PI_SDK_ROOT: root, HOME: root },
});

function fixture(name: string) {
  const root = join(temp, name);
  mkdirSync(dirname(join(root, HOST)), { recursive: true });
  writeFileSync(join(root, "package.json"), '{"version":"0.87.1"}');
  writeFileSync(join(root, HOST), ORIGINAL + "\n// unrelated work\n");
  return root;
}

test("queue patch backs up exact originals and reapplies without writes", () => {
  const root = fixture("valid");
  const before = readFileSync(join(root, HOST), "utf8");
  expect(run(root).exitCode).toBe(0);
  const patched = readFileSync(join(root, HOST), "utf8");
  expect(patched).toBe(before.replace(ORIGINAL, PATCHED));
  const backups = join(root, ".config/theme-backups");
  const names = readdirSync(backups);
  expect(names).toHaveLength(1);
  expect(readFileSync(join(backups, names[0], HOST), "utf8")).toBe(before);
  expect(run(root).exitCode).toBe(0);
  expect(readFileSync(join(root, HOST), "utf8")).toBe(patched);
  expect(readdirSync(backups)).toEqual(names);
});

test("queue patch refuses unknown, changed, partial and duplicate sources before writing", () => {
  for (const state of ["version", "changed", "partial", "modified", "duplicate", "mixed", "missing"]) {
    const root = fixture(state);
    const path = join(root, HOST);
    if (state === "version") writeFileSync(join(root, "package.json"), '{"version":"0.85.2"}');
    if (state === "changed") writeFileSync(path, ORIGINAL.replace("await this.agent.prompt", "await changed.prompt"));
    if (state === "partial") writeFileSync(path, ORIGINAL + "\n" + MARKER);
    if (state === "modified") writeFileSync(path, PATCHED.replace("hasQueuedMessages()", "changed()"));
    if (state === "duplicate") writeFileSync(path, ORIGINAL + ORIGINAL);
    if (state === "mixed") writeFileSync(path, PATCHED + ORIGINAL);
    if (state === "missing") rmSync(path);
    const before = existsSync(path) ? readFileSync(path, "utf8") : null;
    expect(run(root).exitCode).not.toBe(0);
    expect(existsSync(path) ? readFileSync(path, "utf8") : null).toBe(before);
    expect(existsSync(join(root, ".config/theme-backups"))).toBe(false);
  }
  expect(run(join(temp, "absent")).exitCode).toBe(0);
});

nativeTest("settlement rechecks input without bypassing hooks, abort or context validation", async () => {
  const root = join(temp, "boundary-sdk");
  copySdk(sdk!, root);
  applySdkPatches(root, ["pi-compaction-queue"]);
  const { AgentSession } = await import(pathToFileURL(join(root, HOST)).href);

  for (const { abort, canContinue } of [
    { abort: false, canContinue: true },
    { abort: true, canContinue: true },
    { abort: false, canContinue: false },
  ]) {
    let queued = false;
    let continued = 0;
    let boundaries = 0;
    const session = Object.assign(Object.create(AgentSession.prototype), {
      agent: {
        prompt: async () => {},
        hasQueuedMessages: () => queued,
        continue: async () => {
          continued++;
          queued = false;
        },
      },
      _handlePostAgentRun: async () => false,
      _buildBoundaryContext: () => ({ canContinue }),
      _runBeforeSettleBoundary: async () => {
        if (++boundaries === 1) {
          // Enqueue in the microtask gap after the boundary computes its result.
          queueMicrotask(() => {
            queued = true;
            session._agentRunAbortRequested = abort;
          });
        }
        return false;
      },
      _finishCancelledRetry() {},
      _flushPendingBashMessages() {},
      _flushPendingCustomMessages() {},
      _emitAgentSettled: async () => {},
    });
    await session._runAgentPrompt([]);
    const resumes = !abort && canContinue;
    expect(continued).toBe(resumes ? 1 : 0);
    expect(boundaries).toBe(resumes ? 2 : 1);
    expect(queued).toBe(!resumes);
  }
});

nativeTest("compaction delivers queued input across the async run-settlement boundary", async () => {
  const root = join(temp, "sdk");
  copySdk(sdk!, root);
  applySdkPatches(root, ["pi-compaction-queue"]);
  const load = (path: string) => import(pathToFileURL(join(root, path)).href);
  const { Agent } = await load("node_modules/@earendil-works/pi-agent-core/dist/agent.js");
  const { createAssistantMessageEventStream } = await load("node_modules/@earendil-works/pi-ai/dist/index.js");
  const { AgentSession } = await load("dist/core/agent-session.js");
  const { SessionManager } = await load("dist/core/session-manager.js");
  const { SettingsManager } = await load("dist/core/settings-manager.js");
  const { createExtensionRuntime, loadExtensionFromFactory } = await load("dist/core/extensions/loader.js");
  const { createEventBus } = await load("dist/core/event-bus.js");
  const { InteractiveMode } = await load("dist/modes/interactive/interactive-mode.js");

  // Exercise input hooks around the post-run and agent_before_settle awaits.
  // Different depths deliver before, during and after the final queue check.
  const cases = [
    { reason: "threshold", inputHandlers: 2, queued: ["Queued request"] },
    { reason: "threshold", inputHandlers: 0, queued: ["Queued request"] },
    { reason: "threshold", inputHandlers: 3, queued: ["Queued request"] },
    { reason: "threshold", inputHandlers: 2, queued: ["First", "Second", "Third"] },
    { reason: "manual", inputHandlers: 2, queued: ["Queued request"] },
    { reason: "overflow", inputHandlers: 2, queued: ["Queued request"] },
  ];
  for (const mode of ["steer", "followUp"]) {
    for (const { reason, inputHandlers, queued } of cases) {
      const runtime = createExtensionRuntime();
      const extension = await loadExtensionFromFactory((pi: any) => {
        for (let i = 0; i < inputHandlers; i++) pi.on("input", async () => {});
        pi.on("session_before_compact", (event: any) => ({
          compaction: {
            summary: "Test summary",
            firstKeptEntryId: event.preparation.firstKeptEntryId,
            tokensBefore: event.preparation.tokensBefore,
          },
        }));
      }, root, createEventBus(), runtime, "<queue-test>");
      const model = {
        id: "fake", name: "fake", api: "fake", provider: "fake", baseUrl: "",
        reasoning: false, input: ["text"], contextWindow: 1000, maxTokens: 100,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };
      const requests: string[] = [];
      const agent = new Agent({
        initialState: { model, tools: [], systemPrompt: "Test" },
        streamFn: (_model: unknown, context: any) => {
          const user = context.messages.findLast((message: any) => message.role === "user");
          // Overflow retry may retain only the summary, not the original user.
          requests.push(user?.content[0].text ?? "Compacted context");
          const overflow = reason === "overflow" && requests.length === 1;
          const tokens = overflow ? 0 : requests.length === 1 ? 950 : 10;
          const message = {
            role: "assistant", content: [{ type: "text", text: "Finished" }],
            api: "fake", provider: "fake", model: "fake", timestamp: Date.now(),
            stopReason: overflow ? "error" : "stop",
            ...(overflow ? { errorMessage: "prompt is too long" } : {}),
            usage: {
              input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: tokens,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          };
          const stream = createAssistantMessageEventStream();
          stream.push(overflow
            ? { type: "error", reason: "error", error: message }
            : { type: "done", reason: "stop", message });
          stream.end(message);
          return stream;
        },
      });
      const session = new AgentSession({
        agent, sessionManager: SessionManager.inMemory(root), cwd: root, baseToolsOverride: {},
        settingsManager: SettingsManager.inMemory({
          compaction: { enabled: reason !== "manual", reserveTokens: 100, keepRecentTokens: 1 },
        }),
        modelRuntime: { hasConfiguredAuth: () => true, getAuth: async () => undefined },
        resourceLoader: {
          getExtensions: () => ({ extensions: [extension], errors: [], runtime }),
          getSkills: () => ({ skills: [] }), getPrompts: () => ({ prompts: [] }),
          getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => "Test",
          getAppendSystemPrompt: () => [],
        },
      });
      const submissions: Promise<void>[] = [];
      const errors: string[] = [];
      const ui = {
        session: {
          prompt: (text: string, options: unknown) => {
            const submitted = session.prompt(text, options);
            submissions.push(submitted);
            return submitted;
          },
          steer: session.steer.bind(session), followUp: session.followUp.bind(session),
          clearQueue: session.clearQueue.bind(session),
        },
        compactionQueuedMessages: [] as { text: string; mode: string }[],
        isExtensionCommand: () => false, updatePendingMessagesDisplay() {},
        showError: (message: string) => errors.push(message),
      };
      const compactions: string[] = [];
      let flush: Promise<void> | undefined;
      session.subscribe((event: any) => {
        if (event.type === "compaction_start") {
          compactions.push(event.reason);
          ui.compactionQueuedMessages.push(...queued.map(text => ({ text, mode })));
        }
        if (event.type === "compaction_end") {
          flush = InteractiveMode.prototype.flushCompactionQueue.call(ui, { willRetry: event.willRetry });
        }
      });

      try {
        await session.prompt("Initial request");
        if (reason === "manual") await session.compact();
        await flush;
        await Promise.all(submissions);
        await session.waitForIdle();
        expect(compactions).toEqual([reason]);
        expect(errors).toEqual([]);
        // Overflow retries the interrupted response before draining follow-ups.
        const retried = reason === "overflow" && mode === "followUp" ? ["Compacted context"] : [];
        expect(requests.slice(0, 1 + retried.length)).toEqual(["Initial request", ...retried]);
        // The UI submits its first prompt through input hooks but enqueues the
        // rest directly. Preserve that existing behavior; require delivery
        // exactly once regardless of which submission reaches the agent first.
        expect(requests.slice(1 + retried.length).sort()).toEqual([...queued].sort());
        expect(session.isIdle).toBe(true);
        expect(session.pendingMessageCount).toBe(0);
        expect(agent.hasQueuedMessages()).toBe(false);
        expect(ui.compactionQueuedMessages).toEqual([]);
      } finally {
        session.dispose();
      }
    }
  }
});
