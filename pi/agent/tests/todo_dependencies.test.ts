import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkProcess, temporaryDirectory } from "./support/patch_fixtures";

const home = temporaryDirectory("todo-dependencies-");
const root = join(home, ".pi/agent/npm/node_modules/@juicesharp/rpiv-todo");
const patcher = fileURLToPath(new URL("../patches/rpiv_todo_gray.py", import.meta.url));

// Only the 2.9.0 dependency seams are needed; no installed package or session data.
const originals = {
  "tool/types.ts": ["blockedBy", "addBlockedBy", "removeBlockedBy"].map(name => `
\t${name}: Type.Optional(
\t\tType.Array(Type.Number(), {
\t\t\tdescription: "Task dependencies",
\t\t}),
\t),`).join("\n"),
  "todo.ts": `change status/fields/dependencies
\t\tasync execute(_toolCallId, params, _signal, _onUpdate, ctx) {
\t\t\tconst result = applyTaskMutation(getState(sid(ctx)), params.action, params as TaskMutationParams);
\t\t\tcommitState(sid(ctx), result.state);
\t\t\treturn buildToolResult(params.action, params as TaskMutationParams, result.state, result.op);
\t\t},`,
  "view/format.ts": '\tif (t.blockedBy && t.blockedBy.length > 0) {\n'
    + '\t\tline += ` ${theme.fg("muted", `⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}`)}`;\n'
    + '\t}\n'
    + '\tconst block = t.blockedBy?.length ? `    ⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}` : "";\n'
    + '\treturn `  ${glyph} #${t.id} ${sanitizeTerminalText(t.subject)}${form}${block}`;',
  "state/selectors.ts": '/**\n * Whether any visible task carries a `blockedBy` reference.\n */\n'
    + 'export function selectShowTaskIds(state: TaskState): boolean {\n\treturn state.tasks.some(task => task.blockedBy?.length);\n}',
};

const read = (path: string) => readFileSync(join(root, path), "utf8");

test("removes todo dependency controls", () => {
  for (const [file, source] of Object.entries(originals)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  }
  checkProcess(Bun.spawnSync(["python3", "-B", patcher], { env: { ...process.env, HOME: home } }));
  const types = read("tool/types.ts");
  const todo = read("todo.ts");
  const format = read("view/format.ts");
  const selectors = read("state/selectors.ts");

  expect(types).not.toContain("blockedBy: Type.Optional");
  expect(types).not.toContain("addBlockedBy: Type.Optional");
  expect(types).not.toContain("removeBlockedBy: Type.Optional");
  expect(todo).toContain("delete input.blockedBy");
  expect(todo).not.toContain("change status/fields/dependencies");
  expect(format).not.toContain("⛓");
  expect(selectors).toContain("selectShowTaskIds(_state: TaskState)");
});
