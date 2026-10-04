import { expect } from "bun:test";
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sparkleFrames, INTERVAL_MS } from "../extensions/whimsical/animation.ts";
import { SYMBOLS } from "../extensions/whimsical/catalog.ts";
import { temporaryDirectory } from "./support/patch_fixtures";
import { nativeSuite } from "./support/native_suite";

const sdk = process.env.PI_SDK_ROOT;
const { unitTest: test, nativeTest } = nativeSuite(import.meta.path, !!sdk);
const temp = temporaryDirectory("whimsical-");

test("sparkle frames retain their catalog order, colors and message", () => {
  const frames = sparkleFrames("Checking 界...");
  expect(frames).toHaveLength(SYMBOLS.length);
  expect(INTERVAL_MS).toBe(90);
  expect(frames[0]).toBe("\x1b[38;2;255;240;242m★\x1b[39m \x1b[38;2;255;254;235m✧\x1b[39m \x1b[38;2;255;245;235mChecking 界...\x1b[39m \x1b[38;2;239;247;255m✪\x1b[39m");
});

nativeTest("native discovery loads entrypoints only; whimsical keeps loader and widget contracts", async () => {
  const agent = join(temp, "agent");
  const extensions = join(agent, "extensions");
  mkdirSync(extensions, { recursive: true });
  for (const name of ["plan-mode", "whimsical", "whimsical.ts"]) {
    cpSync(fileURLToPath(new URL(`../extensions/${name}`, import.meta.url)), join(extensions, name), { recursive: true });
  }
  // Plan-mode imports its shared palette rather than keeping another hex copy.
  cpSync(fileURLToPath(new URL("../themes", import.meta.url)), join(agent, "themes"), { recursive: true });
  const { discoverAndLoadExtensions } = await import(pathToFileURL(join(sdk!, "dist/core/extensions/loader.js")).href);
  const tui = await import(pathToFileURL(join(sdk!, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);
  const loaded = await discoverAndLoadExtensions([], temp, agent);
  expect(loaded.errors).toEqual([]);
  expect(loaded.extensions.map((extension: any) => extension.path.slice(extensions.length + 1)).sort())
    .toEqual(["plan-mode/index.ts", "whimsical.ts"]);
  const extension = loaded.extensions.find((extension: any) => extension.path.endsWith("whimsical.ts"));
  const terminal = { terminal: { rows: 30, columns: 100 }, requestRender() {} };
  const widgets = new Map<string, any>([["rpiv-todos", undefined]]);
  const visibility: boolean[] = [];
  const ctx = { hasUI: true, ui: {
    setWorkingVisible: (visible: boolean) => visibility.push(visible),
    setWorkingMessage() {},
    setWidget: (key: string, factory: any) => {
      widgets.get(key)?.dispose();
      widgets.delete(key);
      if (factory) widgets.set(key, factory(terminal));
    },
  } };
  const dispatch = async (name: string, event: any = {}, context = ctx) => {
    for (const handler of extension.handlers.get(name) ?? []) await handler(event, context);
  };
  let compact: any;
  let ordinary: any;
  try {
    await dispatch("agent_start");
    const first = widgets.get("whimsical-working");
    expect([...widgets.keys()]).toEqual(["rpiv-todos", "whimsical-working"]);
    expect(first.intervalMs).toBe(90);
    expect(first.render(100)[0]).not.toBe("");
    expect(first.render(100).at(-1)).not.toBe("");
    expect(first.intervalId).not.toBeNull();
    await dispatch("session_before_compact");
    expect(widgets.has("whimsical-working")).toBe(false);
    expect(visibility.at(-1)).toBe(true);
    await dispatch("session_compact");
    expect(widgets.has("whimsical-working")).toBe(true);
    expect(visibility.at(-1)).toBe(false);
    await dispatch("turn_start");
    expect(first.intervalId).toBeNull();
    const next = widgets.get("whimsical-working");
    await dispatch("tool_result", { toolName: "read" });
    expect(widgets.get("whimsical-working")).toBe(next);
    const frames = [...next.frames];
    widgets.delete("rpiv-todos");
    widgets.set("rpiv-todos", undefined);
    await dispatch("tool_result", { toolName: "todo" });
    expect([...widgets.keys()]).toEqual(["rpiv-todos", "whimsical-working"]);
    expect(widgets.get("whimsical-working").frames).toEqual(frames);
    expect(next.intervalId).toBeNull();
    await dispatch("agent_end");
    expect(widgets.has("whimsical-working")).toBe(false);
    expect(visibility.at(-1)).toBe(true);
    await dispatch("session_before_compact");
    await dispatch("session_compact");
    expect(widgets.has("whimsical-working")).toBe(false);
    await dispatch("agent_start", {}, { ...ctx, hasUI: false });
    expect(widgets.has("whimsical-working")).toBe(false);

    compact = new tui.Loader(terminal, (s: string) => s, (s: string) => s, "Compacting... (escape to cancel)");
    expect(compact.frames).toEqual(sparkleFrames("Compacting... (escape to cancel)"));
    expect(compact.message).toBe("");
    ordinary = new tui.Loader(terminal, (s: string) => s, (s: string) => s, "Loading", { frames: ["kept"] });
    expect(ordinary.frames).toEqual(["kept"]);
    const wrapped = tui.Loader.prototype.setIndicator;
    const reloaded = await discoverAndLoadExtensions([], temp, agent);
    expect(reloaded.errors).toEqual([]);
    expect(tui.Loader.prototype.setIndicator).toBe(wrapped);
  } finally {
    for (const widget of widgets.values()) widget?.dispose();
    compact?.stop();
    ordinary?.stop();
  }
});
