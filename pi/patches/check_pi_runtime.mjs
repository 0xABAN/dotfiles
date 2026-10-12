// Offline checks against an already-patched Pi 1.1.0 installation.
// node pi/patches/check_pi_runtime.mjs /absolute/path/to/pi-coding-agent
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

assert(process.argv[2], "Pass the patched SDK root");
const root = resolve(process.argv[2]);
const load = (path) => import(pathToFileURL(`${root}/${path}`).href);
const tui = await load("node_modules/@earendil-works/pi-tui/dist/index.js");
const theme = await load("dist/modes/interactive/theme/theme.js");
const { InteractiveMode } = await load("dist/modes/interactive/interactive-mode.js");
const { AgentSession } = await load("dist/core/agent-session.js");
const { ExtensionRunner } = await load("dist/core/extensions/runner.js");
const components = "dist/modes/interactive/components";
const { TranscriptContainer, startToolTiming, collectToolTimings } = await load(`${components}/transcript.js`);
const { UserMessageComponent } = await load(`${components}/user-message.js`);
const { ToolExecutionComponent } = await load(`${components}/tool-execution.js`);
const { ExtensionSelectorComponent } = await load(`${components}/extension-selector.js`);
const { ActivityNotice } = await load(`${components}/activity-notice.js`);
const { installActivityBudget, CompactWidgetSpacer } = await load(`${components}/compact-layout.js`);

theme.initTheme("dark", false);
const ui = { terminal: { columns: 100, rows: 40 }, requestRender() {} };

// Preserve 1.1's resolver chain, including a renderer for an unregistered tool.
let resolved = 0;
const renderer = { renderCall: () => new tui.Text("custom renderer", 0, 0) };
const session = {
    getToolDefinition: () => undefined,
    getAllTools: () => [{ name: "custom", sourceInfo: { source: "npm:test" } }],
    extensionRunner: {
        extensions: [{ toolRenderers: [(name, next) => {
            resolved++;
            assert.equal(next(), undefined);
            return name === "custom" ? renderer : undefined;
        }] }],
        resolveToolRenderers: ExtensionRunner.prototype.resolveToolRenderers,
    },
};
const definition = InteractiveMode.prototype.getRegisteredToolDefinition.call({ session }, "custom");
assert.equal(resolved, 1);
assert.equal(definition.renderCall, renderer.renderCall);
assert.equal(definition.configsTranscriptSource, "npm:test");

// Native duration reaches renderers, while existing transcript timing survives replay.
const tool = new ToolExecutionComponent("custom", "call-1", { value: "hello" }, {}, definition, ui, root);
startToolTiming(tool);
const manager = { configsToolTimings: new Map() };
await InteractiveMode.prototype.handleEvent.call({
    isInitialized: true, footer: { invalidate() {} }, programStatus: { handleEvent() {} },
    pendingTools: new Map([["call-1", tool]]), sessionManager: manager, ui,
}, {
    type: "tool_execution_end", toolCallId: "call-1", isError: false, durationMs: 123,
    result: { content: [{ type: "text", text: "result" }], details: {} },
});
assert.equal(tool.result.durationMs, 123);
assert.equal(tool.getRenderContext().durationMs, 123);
const timing = manager.configsToolTimings.get("call-1");
assert(timing.durationMs >= 0);
assert.equal(collectToolTimings([{
    type: "message", configsToolTiming: timing,
    message: { role: "toolResult", toolCallId: "call-1", toolName: "custom" },
}]).get("call-1").durationMs, timing.durationMs);

const transcript = new TranscriptContainer(() => 1, () => ui.terminal.rows);
transcript.addChild(new UserMessageComponent("Hello 世界", theme.getMarkdownTheme(), 1, [], 1));
transcript.addChild(tool);
const selector = new ExtensionSelectorComponent("Choose", ["one", "two", "three"], () => {}, () => {}, { tui: ui });
const notice = new ActivityNotice(() => "notice 世界", () => 3);
const markdown = new tui.Markdown("```js\nconst value = 42;\n```", 0, 0, theme.getMarkdownTheme());
for (const rows of [18, 40]) {
    ui.terminal.rows = rows;
    for (const width of [20, 60, 100]) {
        for (const expanded of [false, true]) {
            tool.setExpanded(expanded);
            for (const component of [transcript, selector, notice, markdown]) {
                const lines = component.render(width);
                assert(lines.length > 0);
                assert(lines.every(line => tui.visibleWidth(line) <= width), `${component.constructor.name}: width ${width}`);
            }
        }
    }
}
installActivityBudget(ui, new Map([["agents", {}], ["rpiv-todos", {}]]), new Map());
ui.terminal.rows = 18;
assert(ui.configsActivityRows() >= 1 && ui.configsActivityRows() <= 3);
assert.deepEqual(new CompactWidgetSpacer(ui).render(80), []);
ui.terminal.rows = 40;
assert.equal(ui.configsActivityRows(), Infinity);

// Inset both render modes without starting a terminal or altering image reservations.
for (const Renderer of [tui.TuiMainScreen, tui.TuiAltScreen]) {
    const screen = new Renderer(ui.terminal);
    screen.requestRender = () => {};
    assert.equal(screen.getHorizontalInset(100), 2);
    assert.equal(screen.getHorizontalInset(10), 0);
    assert.deepEqual(screen.insetLines(["text", ""], 100), ["  text", ""]);
    const marker = "\x1b]133;A\x07";
    assert.equal(screen.insetLines([marker + "text"], 100)[0], marker + "  text");
    if (screen.renderInsetLayout) {
        const frame = screen.renderInsetLayout(new tui.Text("frame", 0, 0), 100, 4);
        assert.equal(frame.width, 100);
        assert.equal(frame.root.rect.x, 2);
        assert.equal(frame.root.clip.x, 2);
        assert(frame.lines.some(line => line.startsWith("  frame")));
    }
}
console.log("Renderer resolution, duration forwarding, narrow layouts and both screen modes passed");

// Model-free reproduction: input lands during the final awaited settle boundary.
async function settle({ queued = true, canContinue = true, abort = false, boundaryContinue = false } = {}) {
    let continued = 0;
    let settled = 0;
    let pending = false;
    let boundaryCalls = 0;
    const state = {
        _pendingToolNames: new Set(), _recordSelection() {},
        agent: {
            async prompt() {},
            hasQueuedMessages: () => pending,
            async continue() { continued++; pending = false; },
        },
        async _handlePostAgentRun() { return false; },
        async _runBeforeSettleBoundary() {
            if (boundaryCalls++) return false;
            pending = queued;
            this._agentRunAbortRequested = abort;
            return boundaryContinue;
        },
        _buildBoundaryContext: () => ({ canContinue }),
        _finishCancelledRetry() {}, _flushPendingBashMessages() {}, _flushPendingCustomMessages() {},
        async _emitAgentSettled() { settled++; },
    };
    await AgentSession.prototype._runAgentPrompt.call(state, []);
    assert.equal(settled, 1);
    return continued;
}
assert.equal(await settle(), 1);
assert.equal(await settle({ queued: false }), 0);
assert.equal(await settle({ canContinue: false }), 0);
assert.equal(await settle({ abort: true }), 0);
assert.equal(await settle({ queued: false, boundaryContinue: true }), 1);

const calls = [];
const gate = { _extensionRunner: {
    hasHandlers: () => true,
    async emitToolCall(event) { calls.push(event); return { block: true, reason: "test" }; },
} };
for (const parent of [undefined, "parent-1"]) {
    const result = await AgentSession.prototype._beforeToolCall.call(gate, {
        toolCall: { id: "child-1", name: "write" }, args: { path: "blocked" },
    }, parent);
    assert.equal(result.block, true);
    assert.equal(calls.at(-1).parentToolCallId, parent);
}
console.log("Settlement race, abort/context guards, and direct/nested permission dispatch passed");
