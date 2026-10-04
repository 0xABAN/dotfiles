#!/usr/bin/env python3
"""Resume messages queued between Pi's post-compaction check and idle settlement."""
import json

from patch_support import backup_sources, discover_pi_root, write_sources

HOST = "dist/core/agent-session.js"
MARKER = "// configs:compaction-queue-v2"
ORIGINAL = '''    async _runAgentPrompt(messages) {
        this._agentRunAbortRequested = false;
        // Compaction before the prompt may have scheduled a retry; the new prompt replaces it.
        this._failedResponse = undefined;
        this._recordSelection();
        // The run records the loadout in the transcript; restored tools that did not register by now
        // are dropped, so a tool that never registers does not stay pending.
        this._pendingToolNames.clear();
        this._isAgentRunActive = true;
        try {
            await this.agent.prompt(messages);
            while (!this._agentRunAbortRequested) {
                if (await this._handlePostAgentRun()) {
                    if (this._agentRunAbortRequested)
                        break;
                    await this.agent.continue();
                    continue;
                }
                if (this._agentRunAbortRequested || !(await this._runBeforeSettleBoundary()))
                    break;
                if (this._agentRunAbortRequested)
                    break;
                await this.agent.continue();
            }
        }
        finally {
            if (this._agentRunAbortRequested)
                this._finishCancelledRetry();
            this._failedResponse = undefined;
            this._runSystemPromptOptions = undefined;
            this._flushPendingBashMessages();
            this._flushPendingCustomMessages();
            await this._emitAgentSettled();
        }
    }'''
PATCHED = ORIGINAL.replace(
    '''                if (this._agentRunAbortRequested || !(await this._runBeforeSettleBoundary()))
                    break;
                if (this._agentRunAbortRequested)
                    break;''',
    f'''                {MARKER}
                if (this._agentRunAbortRequested)
                    break;
                const shouldContinue = await this._runBeforeSettleBoundary();
                if (this._agentRunAbortRequested)
                    break;
                // Input hooks can enqueue after the awaited boundary check resolves.
                // Recheck without yielding, but never bypass native context validation.
                if (!shouldContinue && !(this.agent.hasQueuedMessages()
                    && this._buildBoundaryContext([], "agent_before_settle").canContinue))
                    break;''',
)


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    source = sources[HOST]
    if MARKER in source:
        if source.count(MARKER) != 1 or source.count(PATCHED) != 1 or ORIGINAL in source:
            raise ValueError("compaction queue patch changed, duplicated or incomplete")
        return dict(sources)
    if source.count(ORIGINAL) != 1:
        raise ValueError("compaction queue settlement anchor changed or duplicated")
    return {**sources, HOST: source.replace(ORIGINAL, PATCHED)}


def main() -> None:
    root = discover_pi_root()
    if root is None or not root.exists():
        print("Pi SDK not installed; skipping compaction queue fix")
        return
    if json.loads((root / "package.json").read_text()).get("version") != "1.0.0":
        raise ValueError("compaction queue fix requires Pi 1.0.0; review upstream first")
    sources = {HOST: (root / HOST).read_text()}
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(root, sources, "pi-compaction-queue-")
        print(f"Compaction queue backup: {backup}")
        write_sources(root, patched)
    print("Compaction queue fix ready; restart Pi to apply")


if __name__ == "__main__":
    main()
