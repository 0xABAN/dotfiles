import { afterEach, expect, spyOn } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkProcess, describePatch, temporaryDirectory } from "./support/patch-fixtures";
import { nativeSuite } from "./support/native-suite";

const patcher = fileURLToPath(new URL("../patches/jev-direct.py", import.meta.url));
const description = describePatch<{ edits: [string, string, number][]; module: string; helper: string }>(
  patcher, "{'edits': m['EDITS'], 'module': m['MODULE'], 'helper': m['MODULE_SOURCE']}");
const temp = temporaryDirectory("jev-direct-");
const sdk = process.env.PI_SDK_ROOT;
const source = process.env.PI_JEV_ROOT ?? join(homedir(), ".pi/agent/npm/node_modules/pi-jev-router");
const { unitTest: test, nativeTest } = nativeSuite(import.meta.path, !!sdk && existsSync(source));
const helper = join(temp, description.module);
writeFileSync(helper, description.helper);
const { evaluate } = await import(pathToFileURL(helper).href);
const originalKey = process.env.JEV_API_KEY;
let fetchMock: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  fetchMock?.mockRestore();
  fetchMock = undefined;
  if (originalKey === undefined) delete process.env.JEV_API_KEY;
  else process.env.JEV_API_KEY = originalKey;
});

const questions = {
  route: { type: "choice", instructions: "Choose a model.", criteria: { astra: "Hard work", luna: "Routine work" } },
  skill: { type: "boolean", instructions: "Is this skill needed?", criteria: { true: "Relevant", false: "Unneeded" } },
} as const;
const reply = () => ({
  answers: {
    route: { type: "choice", choice: "luna", probabilities: { astra: 0.1, luna: 0.9 } },
    skill: { type: "noul", noul: 0.85 },
  },
  usage: { input_tokens: 100, output_tokens: 20 },
});

function mockFetch(implementation: (...args: any[]) => Promise<Response>) {
  process.env.JEV_API_KEY = "synthetic-jev-key";
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(implementation);
  return fetchMock;
}

test("direct requests translate booleans, normalize answers/usage and never send gateway or Codex credentials", async () => {
  const before = JSON.stringify(questions);
  const signal = new AbortController().signal;
  const fetch = mockFetch(async (url, options) => {
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ Authorization: "Bearer synthetic-jev-key", "Content-Type": "application/json" });
    expect(options.signal).toBe(signal);
    expect(options.redirect).toBe("error");
    expect(JSON.parse(options.body)).toEqual({
      model: "jev-latest", state: { task: "Synthetic routing check" },
      questions: { ...questions, skill: { ...questions.skill, type: "noul" } },
    });
    return Response.json(reply());
  });
  const result = await evaluate({ state: { task: "Synthetic routing check" }, questions, abortSignal: signal });
  expect(result.answers.route).toEqual(reply().answers.route);
  expect(result.answers.skill).toEqual({ type: "boolean", probability: 0.85 });
  expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  expect(JSON.stringify(questions)).toBe(before);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("missing keys and pre-aborted requests do not reach the network", async () => {
  const fetch = mockFetch(async () => Response.json(reply()));
  delete process.env.JEV_API_KEY;
  await expect(evaluate({ state: "test", questions })).rejects.toThrow("Missing JEV_API_KEY");
  process.env.JEV_API_KEY = "  ";
  await expect(evaluate({ state: "test", questions })).rejects.toThrow("Missing JEV_API_KEY");
  const reason = new Error("cancelled");
  await expect(evaluate({ state: "test", questions, abortSignal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  expect(fetch).not.toHaveBeenCalled();
});

test("HTTP/network/JSON failures hide sensitive bodies and leave retries to the router", async () => {
  for (const status of [401, 422, 429, 529]) {
    const fetch = mockFetch(async () => new Response("sensitive response text", { status }));
    try {
      await evaluate({ state: "test", questions });
      throw new Error("expected rejection");
    } catch (error: any) {
      expect(error.statusCode).toBe(status);
      expect(error.message).toBe(`Jev request failed (HTTP ${status}).`);
      expect(error.cause).toBeUndefined();
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockRestore();
  }
  mockFetch(async () => { throw new Error("sensitive request details"); });
  await expect(evaluate({ state: "test", questions })).rejects.toThrow("Jev direct request failed.");
  fetchMock!.mockRestore();
  mockFetch(async () => new Response("sensitive invalid JSON"));
  await expect(evaluate({ state: "test", questions })).rejects.toThrow("Invalid Jev JSON response.");
});

test("cancellation and timeout propagate through pending requests", async () => {
  mockFetch(async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const controller = new AbortController();
  const request = evaluate({ state: "test", questions, abortSignal: controller.signal });
  const reason = new Error("cancelled in flight");
  controller.abort(reason);
  await expect(request).rejects.toBe(reason);
  await expect(evaluate({ state: "test", questions, abortSignal: AbortSignal.timeout(10) })).rejects.toHaveProperty("name", "TimeoutError");
});

test("invalid or incomplete answers fail closed; unknown usage is not invented", async () => {
  for (const answers of [null, {}, { ...reply().answers, route: { ...reply().answers.route, choice: "unlisted" } },
    { ...reply().answers, route: { ...reply().answers.route, probabilities: { luna: 1 } } },
    { ...reply().answers, route: { ...reply().answers.route, probabilities: { luna: 2, astra: -1 } } },
    { ...reply().answers, skill: { type: "noul", noul: "0.9" } },
    { ...reply().answers, skill: { type: "boolean", probability: 0.9 } },
  ]) {
    mockFetch(async () => Response.json({ ...reply(), answers }));
    await expect(evaluate({ state: "test", questions })).rejects.toThrow();
    fetchMock!.mockRestore();
  }
  mockFetch(async () => Response.json({ answers: reply().answers, usage: { input_tokens: -1 } }));
  expect((await evaluate({ state: "test", questions })).usage).toEqual({ inputTokens: undefined, outputTokens: undefined });
});

const run = (root: string) => Bun.spawnSync(["python3", "-B", patcher], {
  env: { ...process.env, HOME: root, PI_JEV_ROOT: root },
});

function sandbox(name: string) {
  const root = join(temp, name);
  mkdirSync(root);
  writeFileSync(join(root, "package.json"), '{"name":"pi-jev-router","version":"0.4.0"}');
  writeFileSync(join(root, "index.ts"), description.edits.map(([old, , count]) => (old + "\n").repeat(count)).join("\n"));
  return root;
}

function contents(root: string) {
  return Object.fromEntries(["package.json", "index.ts", description.module].map(name => [name,
    existsSync(join(root, name)) ? readFileSync(join(root, name), "utf8") : null]));
}

test("patch backs up originals, records its added file and is repeatable", () => {
  const root = sandbox("valid");
  const original = contents(root);
  checkProcess(run(root));
  const patched = contents(root);
  expect(patched[description.module]).toBe(description.helper);
  const backups = join(root, ".config/theme-backups");
  const names = readdirSync(backups);
  expect(names).toHaveLength(1);
  expect(readFileSync(join(backups, names[0], "index.ts"), "utf8")).toBe(original["index.ts"]!);
  expect(JSON.parse(readFileSync(join(backups, names[0], "added-files.json"), "utf8"))).toEqual([description.module]);
  checkProcess(run(root));
  expect(contents(root)).toEqual(patched);
  expect(readdirSync(backups)).toEqual(names);
});

test("incompatible versions, anchors and partial patches fail before writing", () => {
  for (const state of ["version", "owner", "missing-anchor", "duplicate-anchor", "orphan-helper", "missing-helper", "modified-helper", "duplicate-patched"]) {
    const root = sandbox(state);
    if (state === "version" || state === "owner") {
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: state === "owner" ? "imposter" : "pi-jev-router", version: state === "version" ? "0.5.0" : "0.4.0" }));
    } else if (state === "missing-anchor") writeFileSync(join(root, "index.ts"), "changed upstream");
    else if (state === "duplicate-anchor") writeFileSync(join(root, "index.ts"), contents(root)["index.ts"] + description.edits[0][0]);
    else if (state === "orphan-helper") writeFileSync(join(root, description.module), description.helper);
    else {
      checkProcess(run(root));
      if (state === "duplicate-patched") writeFileSync(join(root, "index.ts"), contents(root)["index.ts"] + description.edits[0][1]);
      else if (state === "missing-helper") unlinkSync(join(root, description.module));
      else writeFileSync(join(root, description.module), description.helper + "\n// modified");
    }
    const before = contents(root);
    const backups = join(root, ".config/theme-backups");
    const names = existsSync(backups) ? readdirSync(backups) : [];
    expect(run(root).exitCode).not.toBe(0);
    expect(contents(root)).toEqual(before);
    expect(existsSync(backups) ? readdirSync(backups) : []).toEqual(names);
  }
  expect(run(join(temp, "not-installed")).exitCode).toBe(0);
});

nativeTest("real router dispatches both choices with Codex auth, pins sessions and falls back without Gateway", async () => {
  const root = join(temp, "native");
  mkdirSync(root);
  for (const name of ["index.ts", "package.json", description.module]) {
    if (existsSync(join(source, name))) writeFileSync(join(root, name), readFileSync(join(source, name)));
  }
  checkProcess(run(root));
  checkProcess(run(root));
  for (const [name, target] of [["pi-coding-agent", sdk!], ["pi-ai", join(sdk!, "node_modules/@earendil-works/pi-ai")]]) {
    const link = join(root, "node_modules/@earendil-works", name);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);
  }
  const originalDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    const refs = ["openai-codex/gpt-6-astra", "openai-codex/gpt-5.6-luna"];
    writeFileSync(join(root, "settings.json"), JSON.stringify({ jevRouter: {
      options: Object.fromEntries(refs.map(ref => [ref, { description: ref, thinking: "xhigh" }])), fallback: refs[0], monitor: false,
    } }));
    const { default: router } = await import(pathToFileURL(join(root, "index.ts")).href);
    for (const choice of ["0", "1", "failure"]) {
      const fetch = mockFetch(async (url) => {
        expect(url).toBe("https://api.typesafe.ai/v1/systemone");
        return choice === "failure" ? new Response("private failure", { status: 401 }) : Response.json({
          answers: { route: { type: "choice", choice, probabilities: { "0": 0.5, "1": 0.5 } } }, usage: { input_tokens: 1, output_tokens: 1 },
        });
      });
      const handlers = new Map<string, Function>();
      const commands = new Map<string, any>();
      const entries: any[] = [];
      let registered: any;
      router({ on: (name: string, fn: Function) => handlers.set(name, fn), registerProvider: (_name: string, value: any) => { registered = value; },
        registerCommand: (name: string, value: any) => commands.set(name, value), appendEntry: (customType: string, data: any) => entries.push({ type: "custom", customType, data }),
      });
      const models = refs.map(ref => ({ provider: "openai-codex", id: ref.split("/")[1], api: "openai-codex-responses", reasoning: true,
        thinkingLevelMap: { xhigh: "xhigh" }, input: ["text"], contextWindow: 272000, maxTokens: 128000 }));
      const selected = choice === "1" ? models[1] : models[0];
      const notices: string[] = [];
      const ctx = {
        modelRegistry: {
          getAvailable: () => models,
          getProviderAuth: () => { throw new Error("Gateway auth must not be resolved"); },
          getProvider: (provider: string) => {
            expect(provider).toBe("openai-codex");
            return { async *streamSimple(model: any, _context: any, options: any) {
              expect(model).toEqual(selected);
              expect(options.reasoning).toBe("xhigh");
              expect(options.apiKey).toBe("synthetic-codex-token");
              expect(options.headers).toEqual({ "x-codex": "synthetic" });
              yield { type: "done", reason: "stop", message: { role: "assistant", content: [], stopReason: "stop" } };
            } };
          },
          getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "synthetic-codex-token", headers: { "x-codex": "synthetic" } }),
        },
        sessionManager: { getSessionId: () => "synthetic-session", getEntries: () => entries, getBranch: () => entries },
        ui: { setStatus() {}, notify: (message: string) => notices.push(message) },
      };
      await handlers.get("session_start")!({}, ctx);
      for (let turn = 0; turn < 2; turn++) {
        const stream = registered.streamSimple({ api: "jev-router", provider: "auto", id: "jev" },
          { messages: [{ role: "user", content: `Synthetic task ${turn}`, timestamp: turn }] },
          { sessionId: "synthetic-session", apiKey: "local-router", headers: { "x-router": "not-forwarded" } });
        const events = [];
        for await (const event of stream) events.push(event);
        expect(events.at(-1)?.type).toBe("done");
      }
      expect(entries.find(entry => entry.customType === "jev-pin")?.data).toMatchObject({ target: refs[choice === "1" ? 1 : 0], thinking: "xhigh" });
      expect(fetch).toHaveBeenCalledTimes(1);
      await commands.get("jev").handler("", ctx);
      expect(notices.at(-1)).toContain("Jev API: direct (JEV_API_KEY configured)");
      expect(notices.join("\n")).not.toContain("private failure");
      fetch.mockRestore();
    }
  } finally {
    if (originalDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalDir;
  }
});
