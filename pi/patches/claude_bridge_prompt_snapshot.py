#!/usr/bin/env python3
"""Render Claude bridge's system prompt fresh on every resumed query.

Claude Code records a conversation's system prompt on its first request and
replays that record on every later `--resume`, ignoring a different `append`.
The bridge spawns a resumed query per Pi turn and forwards Pi's whole prompt as
that `append`, so every later prompt change (Learn mode, skills, context files,
tool loadouts) silently never reaches the model. `snapshot: false` is the Agent
SDK's documented opt-out for hosts that change their append within a session.
"""
import json
import os
from pathlib import Path

from patch_support import backup_sources, replace_counted, write_sources

VERSION = "0.9.1"
INDEX = "src/index.ts"
MARKER = "// configs:claude-bridge-prompt-snapshot-v1"
EDITS = [
    ("""\t\tsystemPrompt: {
\t\t\ttype: "preset", preset: "claude_code",
\t\t\tappend: systemPromptAppend ? systemPromptAppend : undefined,
\t\t},
""",
     """\t\tsystemPrompt: {
\t\t\ttype: "preset", preset: "claude_code",
\t\t\tappend: systemPromptAppend ? systemPromptAppend : undefined,
\t\t\t// configs:claude-bridge-prompt-snapshot-v1
\t\t\t// Pi changes its prompt mid-session; a recorded prompt would replay the
\t\t\t// first turn's text on every resume and drop each later change.
\t\t\tsnapshot: false,
\t\t},
""", 1),
]


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    source = sources[INDEX]
    original = source
    if MARKER in source:
        if source.count(MARKER) != 1:
            raise ValueError("duplicated claude-bridge prompt-snapshot marker")
        original = replace_counted(source, EDITS, "claude-bridge prompt-snapshot anchor", reverse=True)

    # Another snapshot setting would make the patch's effect ambiguous; refuse it.
    if "snapshot:" in original:
        raise ValueError("partial or conflicting claude-bridge prompt-snapshot option")
    patched = replace_counted(original, EDITS, "claude-bridge prompt-snapshot anchor")
    if MARKER in source and patched != source:
        raise ValueError("inconsistent claude-bridge prompt-snapshot patch")
    return {**sources, INDEX: patched}


def main() -> None:
    root = Path(os.environ.get(
        "PI_CLAUDE_BRIDGE_ROOT", str(Path.home() / ".pi/agent/npm/node_modules/pi-claude-bridge"),
    )).expanduser()
    if not root.exists():
        print("pi-claude-bridge not installed; skipping prompt-snapshot patch")
        return
    if json.loads((root / "package.json").read_text()).get("version") != VERSION:
        raise ValueError(f"prompt-snapshot patch requires pi-claude-bridge {VERSION}; review upstream first")
    sources = {INDEX: (root / INDEX).read_text()}
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(root, sources, "claude-bridge-prompt-snapshot-")
        print(f"Claude-bridge prompt-snapshot backup: {backup}")
        write_sources(root, patched)
    print("Claude-bridge prompts render per query; restart Pi to apply")


if __name__ == "__main__":
    main()
