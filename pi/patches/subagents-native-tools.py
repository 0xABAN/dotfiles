#!/usr/bin/env python3
"""Give pi-subagents SDK sessions Pi 1.0's native MCP and codemode extensions.

SDK sessions do not load CLI built-ins automatically. Register the same named
built-ins so the existing extension allowlists and isolated mode still apply.
"""
import json
import os
from pathlib import Path

from patch_support import backup_sources, discover_pi_root, replace_counted, write_sources

RUNNER = "src/agent-runner.ts"
MARKER = "// configs:subagents-native-tools-v1"
EDITS = [
    ("  createAgentSession,\n",
     "  createAgentSession,\n  createCodemodeExtension,\n"
     "  createMcpExtension,\n  createToolSearchExtension,\n", 1),
    ("  const loader = new DefaultResourceLoader({\n", """  const loader = new DefaultResourceLoader({
    // configs:subagents-native-tools-v1
    extensionFactories: [
      { name: "codemode", factory: createCodemodeExtension(), builtin: true, replaceable: true },
      { name: "tool-search", factory: createToolSearchExtension(), builtin: true, replaceable: true },
      { name: "mcp", factory: createMcpExtension(), builtin: true, replaceable: true },
    ],
""", 1),
    ('''    const next = session.getAllTools().map((t) => t.name).filter((n) => allowed.has(n));
    const current = session.getActiveToolNames();''', '''    const current = session.getActiveToolNames();
    const active = new Set(current);
    // Keep native MCP behind codemode unless it was explicitly activated.
    const next = session.getAllTools()
      .filter((tool) => allowed.has(tool.name) && (tool.exposure === "direct" || active.has(tool.name)))
      .map((tool) => tool.name);''', 1),
    ('''  const priorBeforeToolCall = session.agent.beforeToolCall;
  session.agent.beforeToolCall = async (context, signal) => {''', '''  // Pi 1.0 routes direct and nested calls through this version-pinned private hook.
  const priorBeforeToolCall = session["_beforeToolCall"].bind(session);
  session["_beforeToolCall"] = async (
    context: Parameters<NonNullable<typeof session.agent.beforeToolCall>>[0],
    parentToolCallId?: string,
  ) => {''', 1),
    ('''    return priorBeforeToolCall?.(context, signal);''',
     '''    return priorBeforeToolCall(context, parentToolCallId);''', 1),
]


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    source = sources[RUNNER]
    original = source
    if MARKER in source:
        if source.count(MARKER) != 1:
            raise ValueError("duplicated subagent native-tools registration")
        original = replace_counted(source, EDITS, "subagent native-tools anchor", reverse=True)

    # A second factory property could silently override ours; refuse it instead.
    if any(token in original for token in (
        "extensionFactories", "createCodemodeExtension", "createMcpExtension", "createToolSearchExtension",
    )):
        raise ValueError("partial or conflicting subagent native-tools registration")
    patched = replace_counted(original, EDITS, "subagent native-tools anchor")
    if MARKER in source and patched != source:
        raise ValueError("inconsistent subagent native-tools patch")
    return {**sources, RUNNER: patched}


def main() -> None:
    root = Path(os.environ.get(
        "PI_SUBAGENTS_ROOT", str(Path.home() / ".pi/agent/npm/node_modules/@tintinweb/pi-subagents"),
    )).expanduser()
    if not root.exists():
        print("pi-subagents not installed; skipping native tools")
        return
    sdk = discover_pi_root()
    if sdk is None or json.loads((sdk / "package.json").read_text()).get("version") != "1.0.0":
        raise ValueError("subagent native tools require Pi 1.0.0; review upstream first")
    if json.loads((root / "package.json").read_text()).get("version") != "0.19.0":
        raise ValueError("subagent native tools require pi-subagents 0.19.0; review upstream first")
    sources = {RUNNER: (root / RUNNER).read_text()}
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(root, sources, "subagents-native-tools-")
        print(f"Subagent native-tools backup: {backup}")
        write_sources(root, patched)
    print("Subagent native tools ready; restart Pi to apply")


if __name__ == "__main__":
    main()
