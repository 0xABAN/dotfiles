#!/usr/bin/env python3
"""Give our activity widgets a shared short-window budget in Pi 0.87.1.

The host supplies available rows; each package retains semantic rendering and
state ownership. Validate the complete patch before backing up or writing.
"""
import json

from patch_support import (
    backup_sources,
    discover_pi_root as discover_root,
    read_payload,
    replace_counted,
    write_sources,
)

HOST = "dist/modes/interactive/interactive-mode.js"
VIEWPORT = "dist/modes/interactive/chat-viewport.js"
# Pi now permits the native footer to collapse; validate, but do not patch it.
VIEWPORT_ANCHOR = '        { component: options.footer, shrink: 1, minSize: 0 },'
MODULE = "dist/modes/interactive/components/compact-layout.js"
SOURCE = read_payload("host/compact-layout.js.inc")
LEGACY_SOURCE = read_payload("host/legacy/compact-layout-v1.js.inc")
MARKER = "// configs:pi-compact-layout-v1"
EDITS = [
    ('import { FooterComponent, formatTokens } from "./components/footer.js";',
     'import { FooterComponent, formatTokens } from "./components/footer.js";\n'
     'import { CompactFooter, CompactWidgetSpacer, installActivityBudget } from "./components/compact-layout.js"; ' + MARKER, 1),
    ('    mountInteractiveTui(tui, components) {',
     '    mountInteractiveTui(tui, components) {\n'
     '        installActivityBudget(tui, this.extensionWidgetsAbove, this.extensionWidgetsBelow);', 1),
    ('container.addChild(new Spacer(1));',
     'container.addChild(new CompactWidgetSpacer(this.ui));', 2),
    ('        this.footerContainer = new Container();',
     '        this.footerContainer = new CompactFooter(this.ui);', 1),
]
PRE_FOOTER_EDITS = [
    (EDITS[0][0], EDITS[0][0] + '\n'
     'import { CompactWidgetSpacer, installActivityBudget } from "./components/compact-layout.js"; ' + MARKER, 1),
    EDITS[1], EDITS[2],
]
# The first revision attached to only the initial renderer through Pi's proxy.
# Migrate that exact hook to the mount boundary, retaining the same helper.
LEGACY_HOOK = (
    '        this.widgetContainerBelow = new Container();',
    '        this.widgetContainerBelow = new Container();\n'
    '        installActivityBudget(this.ui, this.extensionWidgetsAbove, this.extensionWidgetsBelow);', 1,
)
LEGACY_EDITS = [PRE_FOOTER_EDITS[0], LEGACY_HOOK, PRE_FOOTER_EDITS[2]]


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    if sources[VIEWPORT].count(VIEWPORT_ANCHOR) != 1:
        raise ValueError("compact viewport anchor changed or duplicated")
    source = sources[HOST]
    if MARKER in source:
        if source.count(MARKER) != 1 or sources.get(MODULE) not in (SOURCE, LEGACY_SOURCE):
            raise ValueError("compact layout helper changed, duplicated or missing")
        if source.count("installActivityBudget(") != 1:
            raise ValueError("partial or duplicated compact activity budget hook")
        if EDITS[3][1] in source:
            edits = EDITS
            if sources[MODULE] != SOURCE:
                raise ValueError("compact footer requires its matching helper")
        else:
            edits = LEGACY_EDITS if LEGACY_HOOK[1] in source else PRE_FOOTER_EDITS
        original = replace_counted(source, edits, "compact layout anchor", reverse=True)
        if replace_counted(original, edits, "compact layout anchor") != source:
            raise ValueError("inconsistent compact layout patch")
        return {**sources, HOST: replace_counted(original, EDITS, "compact layout anchor"), MODULE: SOURCE}
    if MODULE in sources:
        raise ValueError("unexpected compact layout helper alongside original host")
    if LEGACY_HOOK[1] in source or any(new in source for _, new, _ in EDITS):
        raise ValueError("partial compact layout patch")
    return {
        **sources, HOST: replace_counted(source, EDITS, "compact layout anchor"),
        MODULE: SOURCE,
    }


def main() -> None:
    root = discover_root()
    if root is None or not root.exists():
        print("Pi host not installed; skipping compact layout")
        return
    if json.loads((root / "package.json").read_text()).get("version") != "0.87.1":
        raise ValueError("compact layout requires Pi 0.87.1; review upstream first")
    sources = {name: (root / name).read_text() for name in (HOST, VIEWPORT)}
    if (root / MODULE).exists():
        sources[MODULE] = (root / MODULE).read_text()
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(root, sources, "pi-compact-layout-", added_files=sorted(set(patched) - set(sources)))
        print(f"Compact layout backup: {backup}")
        write_sources(root, patched)
    print("Compact layout ready; restart Pi to apply")


if __name__ == "__main__":
    main()
