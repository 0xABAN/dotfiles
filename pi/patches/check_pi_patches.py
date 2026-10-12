#!/usr/bin/env python3
"""Check the Pi 1.1.0 patch chain without modifying the supplied installations.

Run: python3 -B pi/patches/check_pi_patches.py [SDK_ROOT] [SUBAGENTS_ROOT]
Accepts pristine or fully patched packages. Runtime/render checks live alongside
this file in check_pi_runtime.mjs and require an already-patched SDK.
"""
import ast
import importlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

from patch_support import discover_pi_root

PATCHES = (
    "pi_horizontal_inset", "pi_markdown_code", "pi_transcript",
    "pi_extension_dialogs", "pi_activity_notices", "pi_compact_layout",
    "pi_editor_gap", "pi_compaction_queue",
)


def source_names(module):
    edits = getattr(module, "EDITS", None)
    names = list(edits) if isinstance(edits, dict) else [module.HOST]
    if hasattr(module, "VIEWPORT"):
        names.append(module.VIEWPORT)
    if hasattr(module, "MODULE"):
        names.append(module.MODULE)
    return names


def rejects(call):
    try:
        call()
    except ValueError:
        return
    raise AssertionError("changed source was accepted")


def main():
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else discover_pi_root()
    assert root is not None, "Pi installation required"
    subagents = (Path(sys.argv[2]) if len(sys.argv) > 2
                 else Path.home() / ".pi/agent/npm/node_modules/@tintinweb/pi-subagents")
    for manifest in (root / "package.json", root / "node_modules/@earendil-works/pi-tui/package.json"):
        assert json.loads(manifest.read_text())["version"] == "1.1.0", manifest

    modules = [importlib.import_module(name) for name in PATCHES]
    sources = {}
    for module in modules:
        for name in source_names(module):
            if name not in sources and (root / name).exists():
                sources[name] = (root / name).read_text()
        inputs = {name: sources[name] for name in source_names(module) if name in sources}
        patched = module.patch_sources(inputs)
        assert module.patch_sources(patched) == patched, module.__name__
        rejects(lambda: module.patch_sources({**patched, next(iter(inputs)): ""}))
        sources.update(patched)

    # Patches share host files. Replaying the *whole* chain must also be a no-op.
    for module in modules:
        inputs = {name: sources[name] for name in source_names(module)}
        assert module.patch_sources(inputs) == inputs, module.__name__
    for name, source in sources.items():
        subprocess.run(["node", "--input-type=module", "--check"], input=source, text=True, check=True)
    print("Eight host patches: apply, full-chain replay, changed-source refusal, JS syntax passed")

    native = importlib.import_module("subagents-native-tools")
    assert json.loads((subagents / "package.json").read_text())["version"] == "0.19.0"
    patched = native.patch_sources({native.RUNNER: (subagents / native.RUNNER).read_text()})
    assert native.patch_sources(patched) == patched
    rejects(lambda: native.patch_sources({native.RUNNER: patched[native.RUNNER].replace(native.MARKER, "")}))
    # Both direct and nested calls must still traverse the hook the patch gates.
    session = sources["dist/core/agent-session.js"]
    assert "this.agent.beforeToolCall = (context) => this._beforeToolCall(context);" in session
    assert "beforeToolCall: (context) => this._beforeToolCall(context, parentId)," in session
    assert "async _beforeToolCall({ toolCall, args }, parentToolCallId)" in session
    print("Subagent patch: replay, partial-patch refusal, direct/nested hook contracts passed")

    # Exercise the actual embedded launcher selector, without running install.sh.
    installer = Path(__file__).resolve().parents[2] / "install.sh"
    block = installer.read_text().split('python3 -B - "$ROOT/pi/patches" <<\'PY\'\n', 1)[1].split("\nPY", 1)[0]
    tree = ast.parse(block)
    # Exclude top-level execution (discovery, sys.path mutation, live selection).
    tree.body = [node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef))
                 or isinstance(node, ast.Assign) and all(isinstance(t, ast.Name) and t.id.isupper() for t in node.targets)]
    namespace = {}
    exec(compile(tree, str(installer), "exec"), namespace)
    with tempfile.TemporaryDirectory(prefix="pi-launcher-check-") as directory:
        path = Path(directory)
        launcher = path / "pi"
        stock = root.resolve() / namespace["STOCK"]
        custom = root.resolve() / namespace["CUSTOM"]
        launcher.symlink_to(stock)
        backup = namespace["select_launcher"](root, launcher, path / "backups")
        assert launcher.resolve() == custom
        assert json.loads((backup / "launcher.json").read_text())["target"] == str(stock)
        assert namespace["select_launcher"](root, launcher, path / "backups") is None
        launcher.unlink()
        launcher.symlink_to(path / "unknown")
        (path / "unknown").write_text("not a Pi launcher")
        rejects(lambda: namespace["select_launcher"](root, launcher, path / "backups"))
        assert launcher.readlink() == path / "unknown"
    print("Launcher: published entry hashes, selection, replay, unknown-target refusal passed")


if __name__ == "__main__":
    main()
