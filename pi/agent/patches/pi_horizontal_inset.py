#!/usr/bin/env python3
"""Give Pi 1.0.0 one horizontal viewport boundary in both renderer modes.

Patch the private Pi-bundled TUI, never terminal dimensions or terminal writes.
Regular output is inset before overlays/cursor extraction. Fullscreen paints its
native layout at the inner width, then translates both pixels and hit-test boxes;
this preserves the native image fast path and scroll-relative document columns.
A Pi process restart is required: /reload does not reload host JavaScript.
"""
import json
from pathlib import Path

from patch_support import (
    read_payload,
    discover_pi_root as discover_root,
    backup_sources,
    write_sources,
)


TUI = "node_modules/@earendil-works/pi-tui/dist/"
EDITS = {
    TUI + "tui.js": [
        ("    resetRenderState() { }", read_payload('host/viewport_inset.js.inc')),
        ("return entry.options.visible(this.terminal.columns, this.terminal.rows);",
         "return entry.options.visible(this.terminal.columns - 2 * this.getHorizontalInset(), this.terminal.rows);"),
        ('''    resolveOverlayLayout(options, overlayHeight, termWidth, termHeight) {
        const opt = options ?? {};''', '''    resolveOverlayLayout(options, overlayHeight, termWidth, termHeight) {
        const inset = this.getHorizontalInset(termWidth);
        termWidth -= 2 * inset;
        const opt = options ?? {};'''),
        ("        return { width, row, col, maxHeight };", "        return { width, row, col: col + inset, maxHeight };"),
    ],
    TUI + "tui-main-screen.js": [
        ("        let newLines = this.render(width);", '''        // configs:pi-horizontal-inset-v1: wrap once, before overlays and cursor extraction.
        let newLines = this.insetLines(this.render(width - 2 * this.getHorizontalInset(width)), width);'''),
    ],
    TUI + "tui-alt-screen.js": [
        ('''    getMountedRoots() {''', read_payload('host/inset_layout.js.inc')),
        ('''            const documentLines = this.render(width).map((line) => line.replace(OSC133_ZONE_PREFIX, ""));''', '''            const documentLines = this.insetLines(
                this.render(width - 2 * this.getHorizontalInset(width)).map((line) => line.replace(OSC133_ZONE_PREFIX, "")), width);'''),
        ('''        const flashLines = this.flashes.render(width).slice(-height);''', '''        const inset = this.getHorizontalInset(width);
        const flashLines = this.flashes.render(width - 2 * inset).slice(-height);'''),
        ("line, width - flashWidth, flashWidth, width);", "line, width - inset - flashWidth, flashWidth, width);"),
        ("        let nextLayout = renderLayoutFrame(root, width, height, () => this.requestRender());", "        let nextLayout = this.renderInsetLayout(root, width, height);"),
        ("            nextLayout = renderLayoutFrame(root, width, height, () => this.requestRender());", "            nextLayout = this.renderInsetLayout(root, width, height);"),
    ],
}


# Exact earlier spelling is accepted only through the existing guarded migration.
LEGACY_INSET = read_payload('host/legacy/viewport_inset.js.inc')


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    """Check every anchor before any write, including idempotence/partial state."""
    sources = dict(sources)
    sources[TUI + "tui.js"] = sources[TUI + "tui.js"].replace(LEGACY_INSET, EDITS[TUI + "tui.js"][0][1])
    states = []
    for name, edits in EDITS.items():
        for old, new in edits:
            source = sources[name]
            if source.count(new) == 1:
                states.append("patched")
            elif source.count(new) == 0 and source.count(old) == 1:
                states.append("original")
            else:
                raise ValueError(f"{name}: horizontal inset anchor changed or duplicated: {old[:70]}")
    if len(set(states)) != 1:
        raise ValueError("partial horizontal inset patch; inspect before reapplying")
    if states[0] == "patched":
        return sources
    result = {}
    for name, source in sources.items():
        for old, new in EDITS[name]:
            source = source.replace(old, new, 1)
        result[name] = source
    return result


def main() -> None:
    root = discover_root()
    if root is None or not root.exists():
        print("Pi host not installed; skipping horizontal inset patch")
        return
    version = json.loads((root / "package.json").read_text())["version"]
    if version != "1.0.0":
        raise ValueError(f"horizontal inset patch requires Pi 1.0.0, found {version}; review upstream first")
    sources = {name: (root / name).read_text() for name in EDITS}
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(root, sources, "pi-horizontal-inset-")
        print(f"Pi host backup: {backup}")
        write_sources(root, patched)
    print("Pi shared horizontal inset ready; restart Pi to apply")


if __name__ == "__main__":
    main()
