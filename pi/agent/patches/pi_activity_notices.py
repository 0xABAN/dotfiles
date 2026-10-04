#!/usr/bin/env python3
"""Align Pi 1.0.0 notices without losing native theme refresh or status coalescing.

Disable automatic package-update reminders, not manual updates or other warnings.
"""
import json

from patch_support import backup_sources, discover_pi_root, read_payload, write_sources

HOST = "dist/modes/interactive/interactive-mode.js"
MODULE = "dist/modes/interactive/components/activity-notice.js"
SOURCE = read_payload("host/activity_notice.js.inc")
EDITS = [
    ('import { CustomEntryComponent } from "./components/custom-entry.js";',
     'import { CustomEntryComponent } from "./components/custom-entry.js";\n'
     'import { ActivityNotice } from "./components/activity-notice.js"; // configs:pi-activity-notices-v2'),
    ('new ThemedText(() => theme.fg("dim", this.lastStatusMessage), 1, 0)',
     'new ActivityNotice(() => theme.fg("dim", this.lastStatusMessage), () => this.outputPad + 2)'),
    ('new ThemedText(() => theme.fg("error", `Error: ${errorMessage}`), this.outputPad, 0)',
     'new ActivityNotice(() => theme.fg("error", `Error: ${errorMessage}`), () => this.outputPad + 2)'),
    ('new ThemedText(() => theme.fg("warning", `Warning: ${warningMessage}`), 1, 0)',
     'new ActivityNotice(() => theme.fg("warning", `Warning: ${warningMessage}`), () => this.outputPad + 2)'),
    ('''    async checkForPackageUpdates() {
        if (process.env.PI_OFFLINE) {
            return [];
        }
        try {
            const packageManager = new DefaultPackageManager({
                cwd: this.sessionManager.getCwd(),
                agentDir: getAgentDir(),
                settingsManager: this.settingsManager,
            });
            const updates = await packageManager.checkForAvailableUpdates();
            return updates.map((update) => update.displayName);
        }
        catch {
            return [];
        }
    }''', '''    async checkForPackageUpdates() {
        // configs: skip startup package reminders; manual updates remain available.
        return [];
    }'''),
]


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    """Accept only a complete pristine or current patch before writing anything."""
    source = sources[HOST]
    remainder = source
    for _, new in EDITS:
        if source.count(new) == 1:
            remainder = remainder.replace(new, "", 1)
    states = []
    for old, new in EDITS:
        if source.count(new) == 1 and old not in remainder:
            states.append("patched")
        elif source.count(new) == 0 and source.count(old) == 1:
            states.append("original")
        else:
            raise ValueError(f"notification anchor changed or duplicated: {old[:70]}")
    if len(set(states)) != 1:
        raise ValueError("partial notification patch; inspect before reapplying")
    if states[0] == "patched":
        if sources.get(MODULE) != SOURCE:
            raise ValueError("notification helper changed or missing")
        return dict(sources)
    if MODULE in sources:
        raise ValueError("unexpected notification helper alongside original host")
    for old, new in EDITS:
        source = source.replace(old, new, 1)
    return {HOST: source, MODULE: SOURCE}


def main() -> None:
    root = discover_pi_root()
    if root is None or not root.exists():
        print("Pi host not installed; skipping activity notices")
        return
    if json.loads((root / "package.json").read_text()).get("version") != "1.0.0":
        raise ValueError("activity notices require Pi 1.0.0; review upstream first")
    sources = {HOST: (root / HOST).read_text()}
    if (root / MODULE).exists():
        sources[MODULE] = (root / MODULE).read_text()
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(root, sources, "pi-activity-notices-", added_files=sorted(set(patched) - set(sources)))
        print(f"Activity notices backup: {backup}")
        write_sources(root, patched)
    print("Activity notices ready; restart Pi to apply")


if __name__ == "__main__":
    main()
