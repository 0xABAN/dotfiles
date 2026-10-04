import { expect, test } from "bun:test";
import { extractPlanSteps } from "../extensions/plan-mode/utils.ts";
import { planModeHarness as harness } from "./support/plan_mode_harness";

test("mode transitions preserve custom tools and only filter inactive plan context", async () => {
  const app = harness();
  const originalTools = [...app.tools()];
  await app.event("session_start");
  const ordinary = { role: "user", content: "continue" };
  const messages = [ordinary, { role: "custom", customType: "plan-mode-context" },
    { role: "user", content: "[PLAN MODE ACTIVE] old instructions" },
    { role: "user", content: [{ type: "text", text: "[PLAN MODE ACTIVE]" }] }];
  expect((await app.event("context", { messages })).messages).toEqual([ordinary]);
  await app.toggle();
  expect(app.tools()).toContain("custom");
  expect(app.tools()).not.toContain("write");
  expect(app.tools().filter(tool => tool === "todo")).toHaveLength(1);
  const active = await app.event("context", { messages });
  expect(active?.messages ?? messages).toEqual(messages);
  await app.event("agent_end", { messages: [
    { role: "assistant", content: [{ type: "text", text: "Plan:\n1. Ignore old plan" }] },
    { role: "assistant", content: [{ type: "text", text: "Plan:\n1. Inspect source\n2. Run checks" }] },
    { role: "toolResult", content: [] },
  ] });
  expect(app.tools()).toEqual(originalTools);
  expect(app.states.at(-1).enabled).toBe(false);
  expect(app.messages[0].content).toContain("1. Inspect source\n2. Run checks");
  expect(app.messages[0].content).not.toContain("Ignore old plan");
});

test("session restore uses the last plan state", async () => {
  const app = harness([
    { type: "custom", customType: "plan-mode", data: { enabled: false } },
    { type: "custom", customType: "plan-mode", data: { enabled: true, toolsBeforePlanMode: ["read", "special"] } },
    { type: "custom", customType: "unrelated", data: { enabled: false } },
  ]);
  await app.event("session_start");
  expect(app.states).toHaveLength(0);
  expect(app.tools()).toContain("special");
  await app.toggle();
  expect(app.tools()).toEqual(["read", "special", "todo"]);
});

test("Execute explicitly disables plan mode even if it changed while the dialog was open", async () => {
  const app = harness();
  await app.toggle();
  app.ctx.ui.select = async () => {
    await app.toggle();
    return "Execute the plan";
  };
  await app.event("agent_end", { messages: [
    { role: "assistant", content: [{ type: "text", text: "Plan:\n1. Inspect source" }] },
  ] });
  expect(app.states.map(state => state.enabled)).toEqual([true, false, false]);
  expect(app.tools()).toEqual(["read", "bash", "edit", "write", "custom", "todo"]);
  expect(app.messages).toHaveLength(1);
});

test("plan extraction keeps existing Markdown and acceptance behavior", () => {
  expect(extractPlanSteps("No plan here\n1. Inspect source")).toEqual([]);
  expect(extractPlanSteps("**Plan:**\n1. **inspect `src`**\n2)   run   checks\n3. /skip command\n4. -skip line\n5. tiny"))
    .toEqual(["Inspect src", "Run checks"]);
});
