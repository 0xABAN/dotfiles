#!/usr/bin/env python3
"""Keep Pi's idle editor separator out of active compaction layout."""
import json

from patch_support import backup_sources, discover_pi_root, read_payload, replace_counted, write_sources

HOST = "dist/modes/interactive/interactive-mode.js"
SOURCE = read_payload("host/editor_gap.js.inc")
LEGACY_SOURCE = read_payload("host/legacy/editor_gap_v1.js.inc")
MARKER = "// configs:editor-gap-v2"
LEGACY_MARKER = "// configs:editor-gap-v1"
EDITOR_ORIGINAL = '''        this.editor = this.defaultEditor;
        this.editorContainer = new Container();
        this.editorContainer.addChild(this.editor);'''
WIDGET_ORIGINAL = '''    renderWidgetContainer(container, widgets, spacerWhenEmpty, leadingSpacer) {
        container.clear();
        if (widgets.size === 0) {
            if (spacerWhenEmpty) {
                container.addChild(new CompactWidgetSpacer(this.ui));
            }
            return;
        }
        if (leadingSpacer) {
            container.addChild(new CompactWidgetSpacer(this.ui));
        }
        for (const component of widgets.values()) {
            container.addChild(component);
        }
    }'''


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    source = sources[HOST]
    if MARKER in source:
        if (source.count(MARKER) != 1 or source.count(SOURCE) != 1
                or source.count(WIDGET_ORIGINAL) != 0
                or source.count(LEGACY_MARKER) != 0):
            raise ValueError("editor gap patch changed, duplicated or incomplete")
        return dict(sources)
    if LEGACY_MARKER in source:
        if source.count(LEGACY_SOURCE) != 1 or source.count(SOURCE) != 0:
            raise ValueError("editor gap legacy patch changed or partially applied")
        source = replace_counted(source, [(LEGACY_SOURCE, EDITOR_ORIGINAL, 1)], "editor gap legacy migration")
    elif source.count(EDITOR_ORIGINAL) != 1:
        raise ValueError("editor gap editor anchor changed or partially applied")
    if source.count(WIDGET_ORIGINAL) != 1 or source.count(SOURCE) != 0:
        raise ValueError("editor gap widget anchor changed or partially applied")
    return {**sources, HOST: replace_counted(source, [(WIDGET_ORIGINAL, SOURCE, 1)], "editor gap widget anchor")}


def main() -> None:
    root = discover_pi_root()
    if root is None or not root.exists():
        print("Pi SDK not installed; skipping editor gap")
        return
    if json.loads((root / "package.json").read_text()).get("version") != "0.87.1":
        raise ValueError("editor gap requires Pi 0.87.1; review upstream first")
    if not (root / HOST).exists():
        raise ValueError("editor gap source is missing")
    sources = {HOST: (root / HOST).read_text()}
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(root, sources, "pi-editor-gap-")
        print(f"Editor gap backup: {backup}")
        write_sources(root, patched)
    print("Editor gap ready; restart Pi to apply")


if __name__ == "__main__":
    main()
