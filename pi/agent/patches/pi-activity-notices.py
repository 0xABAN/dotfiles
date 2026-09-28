#!/usr/bin/env python3
"""Align native extension notifications with the transcript body in Pi 0.87.1.

The host owns notification wrapping. Prefixing extension strings with spaces
only indents their first line, so use a responsive component at that boundary.
"""
import json
from pathlib import Path

from patch_support import (
    read_payload,
    discover_pi_root as discover_root,
    backup_sources,
    write_sources,
)

HOST = "dist/modes/interactive/interactive-mode.js"
MODULE = "dist/modes/interactive/components/activity-notice.js"
SOURCE = read_payload('host/activity-notice.js.inc')
LEGACY_SOURCE = read_payload('host/legacy/activity-notice.js.inc')
LEGACY_PACKAGE_UPDATE_NOTICE = read_payload('host/legacy/activity-notice-package-borders.js.inc')
LEGACY_GRAY_PACKAGE_UPDATE_NOTICE = read_payload('host/legacy/activity-notice-package-gray.js.inc')
PACKAGE_UPDATE_NOTICE = r'''    showPackageUpdateNotification(packages) {
        const action = theme.fg("accent", `${APP_NAME} update --extensions`);
        const updateInstruction = theme.fg("muted", "Package updates are available. Run ") + action;
        const packageLines = packages.map((pkg) => `- ${pkg}`).join("\n");
        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
        this.chatContainer.addChild(new Text(`${theme.bold(theme.fg("warning", "Package Updates Available"))}\n${updateInstruction}\n${theme.fg("muted", "Packages:")}\n${packageLines}`, 1, 0));
        this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
        this.ui.requestRender();
    }'''
PACKAGE_UPDATE_NOTICE_NEW = r'''    showPackageUpdateNotification(packages) {
        const action = theme.fg("accent", `${APP_NAME} update --extensions`);
        const updateInstruction = theme.fg("muted", "Package updates are available. Run ") + action;
        const packageLines = packages.map((pkg) => `- ${pkg}`).join("\n");
        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(new Text(`${theme.bold(theme.fg("toolOutput", "Package Updates Available"))}\n${updateInstruction}\n${theme.fg("muted", "Packages:")}\n${packageLines}`, 1, 1, (text) => theme.bg("userMessageBg", text)));
        this.ui.requestRender();
    }'''
EDITS = [
    ('import { CustomEntryComponent } from "./components/custom-entry.js";',
     'import { CustomEntryComponent } from "./components/custom-entry.js";\n'
     'import { ActivityNotice } from "./components/activity-notice.js"; // configs:pi-activity-notices-v1'),
    ('const text = new Text(theme.fg("dim", message), 1, 0);',
     'const text = new ActivityNotice(theme.fg("dim", message), () => this.outputPad + 2);'),
    ('new Text(theme.fg("error", `Error: ${errorMessage}`), this.outputPad, 0)',
     'new ActivityNotice(theme.fg("error", `Error: ${errorMessage}`), () => this.outputPad + 2)'),
    ('new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0)',
     'new ActivityNotice(theme.fg("warning", `Warning: ${warningMessage}`), () => this.outputPad + 2)'),
    (PACKAGE_UPDATE_NOTICE, PACKAGE_UPDATE_NOTICE_NEW),
]


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    source = sources[HOST]
    remainder = source
    for _, new in EDITS:
        if source.count(new) == 1:
            remainder = remainder.replace(new, "", 1)
    legacy_package_update_notice = next((notice for notice in (LEGACY_PACKAGE_UPDATE_NOTICE, LEGACY_GRAY_PACKAGE_UPDATE_NOTICE)
                                         if source.count(notice) == 1), None)
    states = []
    for index, (old, new) in enumerate(EDITS):
        if source.count(new) == 1 and old not in remainder:
            states.append("patched")
        elif (index == len(EDITS) - 1
                and source.count(new) == 0
                and legacy_package_update_notice is not None):
            states.append("legacy")
        elif source.count(new) == 0 and source.count(old) == 1:
            states.append("original")
        else:
            raise ValueError(f"notification anchor changed or duplicated: {old[:70]}")
    # Migrate the complete previous notice patch; unknown helpers still refuse.
    if states == ["patched"] * (len(EDITS) - 1) + ["legacy"]:
        if sources.get(MODULE) not in (SOURCE, LEGACY_SOURCE):
            raise ValueError("notification helper changed or missing")
        return {**sources, HOST: source.replace(legacy_package_update_notice, EDITS[-1][1], 1), MODULE: SOURCE}
    if states == ["patched"] * (len(EDITS) - 1) + ["original"]:
        if sources.get(MODULE) not in (SOURCE, LEGACY_SOURCE):
            raise ValueError("notification helper changed or missing")
        old, new = EDITS[-1]
        return {**sources, HOST: source.replace(old, new, 1), MODULE: SOURCE}
    if len(set(states)) != 1:
        raise ValueError("partial notification patch; inspect before reapplying")
    if states[0] == "patched":
        if sources.get(MODULE) not in (SOURCE, LEGACY_SOURCE):
            raise ValueError("notification helper changed or missing")
        return {**sources, MODULE: SOURCE}
    if MODULE in sources:
        raise ValueError("unexpected notification helper alongside original host")
    for old, new in EDITS:
        source = source.replace(old, new, 1)
    return {HOST: source, MODULE: SOURCE}


def main() -> None:
    root = discover_root()
    if root is None or not root.exists():
        print("Pi host not installed; skipping activity notices")
        return
    if json.loads((root / "package.json").read_text()).get("version") != "0.87.1":
        raise ValueError("activity notices require Pi 0.87.1; review upstream first")
    sources = {HOST: (root / HOST).read_text()}
    if (root / MODULE).exists():
        sources[MODULE] = (root / MODULE).read_text()
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(
            root, sources, "pi-activity-notices-", added_files=sorted(set(patched) - set(sources)),
        )
        print(f"Activity notices backup: {backup}")
        write_sources(root, patched)
    print("Activity notices ready; restart Pi to apply")


if __name__ == "__main__":
    main()
