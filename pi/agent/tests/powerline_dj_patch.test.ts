import { afterAll, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = mkdtempSync(join(tmpdir(), "powerline-dj-patch-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const patcher = fileURLToPath(new URL("../patches/powerline_dj.py", import.meta.url));

// Preserve the exact upstream anchors; unrelated powerline implementation is unnecessary here.
const fixture = `function fixture(pi: any, ctx: any) {
  let enabled = true, currentCtx = ctx, tuiRef = {};
  function renderLastPromptLines(width: number) { return ctx.prompt.slice(0, width); }
  function installPowerlineWidgets(ctx: any) {
    ctx.ui.setWidget("powerline-top", () => ({ render: () => ["powerline"] }));
    ctx.ui.setWidget("powerline-last-prompt", () => ({
      dispose() {},
      invalidate() {},
      render(width: number): string[] {
        return renderLastPromptLines(width);
      },
    }), { placement: "belowEditor" });
  }
  return {
    install: () => installPowerlineWidgets(ctx),
    disable: () => { enabled = false; },
    enable: () => { enabled = true; },
    shutdown: () => { currentCtx = null; tuiRef = null; },
  };
}`;

function sandbox(name: string, source?: string) {
  const home = join(root, name);
  const target = join(home, ".pi/agent/git/github.com/nicobailon/pi-powerline-footer/index.ts");
  mkdirSync(dirname(target), { recursive: true });
  if (source !== undefined) writeFileSync(target, source);
  const run = () => Bun.spawnSync(["python3", "-B", patcher], {
    env: { ...process.env, HOME: home },
  });
  return { target, run };
}

test("patch is repeatable, preserves unrelated text, and skips missing installations", () => {
  expect(sandbox("missing").run().exitCode).toBe(0);
  const app = sandbox("valid", fixture + "\n// user-owned change\n");
  expect(app.run().exitCode).toBe(0);
  const patched = readFileSync(app.target, "utf8");
  expect(patched).toContain("// user-owned change");
  expect(patched).toContain('pi.events.emit("powerline:widgets-installed", undefined)');
  expect(app.run().exitCode).toBe(0);
  expect(readFileSync(app.target, "utf8")).toBe(patched);
});

test("unknown or incomplete upstream sources fail without writing", () => {
  for (const [name, source] of [
    ["changed", fixture.replace("renderLastPromptLines(width)", "newRenderer(width)")],
    ["partial", "  // configs:powerline-dj-v1\n" + fixture],
    ["duplicate", fixture + fixture],
  ]) {
    const app = sandbox(name, source);
    expect(app.run().exitCode).not.toBe(0);
    expect(readFileSync(app.target, "utf8")).toBe(source);
  }
});

test("patched powerline reorders only its own prompt and respects disable/shutdown", () => {
  const app = sandbox("behavior", fixture);
  expect(app.run().exitCode).toBe(0);
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(readFileSync(app.target, "utf8"));
  const createPowerline = new Function(js + "\nreturn fixture;")();
  const events = new EventEmitter();
  const widgets = new Map<string, { render(width: number): string[] }>();
  const ctx = {
    hasUI: true,
    prompt: ["original prompt"],
    ui: {
      setWidget(id: string, factory: () => { render(width: number): string[] }) {
        expect(id.startsWith("powerline-")).toBe(true);
        widgets.delete(id);
        widgets.set(id, factory());
      },
    },
  };
  const powerline = createPowerline({ events }, ctx);
  const mountDJ = () => {
    widgets.delete("dj");
    widgets.set("dj", { render: () => ["spotify idle"] });
    events.emit("dj:mounted");
  };
  events.on("powerline:widgets-installed", mountDJ);

  mountDJ(); // DJ may start first, or re-enable after powerline has mounted.
  for (const action of [powerline.install, mountDJ, powerline.install]) {
    action();
    expect([...widgets.keys()]).toEqual(["powerline-top", "dj", "powerline-last-prompt"]);
  }
  ctx.prompt = ["updated prompt"];
  expect(widgets.get("powerline-last-prompt")!.render(80)).toEqual(ctx.prompt);

  powerline.disable();
  widgets.delete("powerline-last-prompt");
  mountDJ();
  expect(widgets.has("powerline-last-prompt")).toBe(false);
  powerline.enable();
  powerline.install();
  powerline.shutdown();
  widgets.delete("powerline-last-prompt");
  mountDJ();
  expect(widgets.has("powerline-last-prompt")).toBe(false);
});
