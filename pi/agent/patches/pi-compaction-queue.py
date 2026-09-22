#!/usr/bin/env python3
"""Resume messages queued between Pi's post-compaction check and idle settlement."""
import json

from patch_support import backup_sources, discover_pi_root, write_sources

HOST = "dist/core/agent-session.js"
MARKER = "// configs:compaction-queue-v1"
ORIGINAL = '''    async _runAgentPrompt(messages) {
        this._isAgentRunActive = true;
        try {
            await this.agent.prompt(messages);
            while (await this._handlePostAgentRun()) {
                await this.agent.continue();
            }
        }
        finally {
            this._systemPromptOverride = undefined;
            this._flushPendingBashMessages();
            this._flushPendingCustomMessages();
            await this._emitAgentSettled();
        }
    }'''
PATCHED = ORIGINAL.replace(
    "            while (await this._handlePostAgentRun()) {",
    f'''            {MARKER}
            // Input hooks can enqueue after the awaited post-run check resolves.
            // Recheck without yielding before idle settlement so that input resumes.
            while ((await this._handlePostAgentRun()) || this.agent.hasQueuedMessages()) {{''',
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
    if json.loads((root / "package.json").read_text()).get("version") != "0.85.1":
        raise ValueError("compaction queue fix requires Pi 0.85.1; review upstream first")
    sources = {HOST: (root / HOST).read_text()}
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(root, sources, "pi-compaction-queue-")
        print(f"Compaction queue backup: {backup}")
        write_sources(root, patched)
    print("Compaction queue fix ready; restart Pi to apply")


if __name__ == "__main__":
    main()
