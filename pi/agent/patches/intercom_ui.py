#!/usr/bin/env python3
"""Align pi-intercom 0.13.0 incoming messages with the transcript; no delivery edits.

Outgoing renderers stay native. The host's shared invocation row hides their
bodies only while collapsed. Validate both incoming source anchors together
before backing up or writing; unknown/partial installations refuse.
"""
import json
import os
from pathlib import Path

from patch_support import read_payload, backup_sources, write_sources, replace_counted

MODULE = "ui/inline-message.ts"
ORIGINAL_MODULE = read_payload("intercom/inline_message_original.ts.inc")
MODULE_SOURCE = read_payload("intercom/inline_message.ts.inc")
PRE_TOOL_ROW_MODULE = read_payload("intercom/legacy/inline_message_before_tool_row.ts.inc")
PRE_CHAT_ICON_MODULE = read_payload("intercom/legacy/inline_message_before_chat_icon.ts.inc")
_BODY_DECLARATION = '    const body = clean(this.bodyText || this.message.content.text);'
_PREVIOUS_MODULE_SOURCE = PRE_TOOL_ROW_MODULE.replace(
    '    if (this.collapsed) {',
    _BODY_DECLARATION + "\n\n    if (this.collapsed) {", 1,
).replace(
    _BODY_DECLARATION + "\n    const add =", "    const add =", 1,
)
if _PREVIOUS_MODULE_SOURCE == PRE_TOOL_ROW_MODULE:
    raise ValueError("Intercom cleanup migration anchor changed")
EDITS = {
    "index.ts": [
        ('return new InlineMessageComponent(details.from, details.message, theme, details.replyCommand, details.bodyText, !options.expanded);',
         'return new InlineMessageComponent(details.from, details.message, theme, details.replyCommand, details.bodyText, !options.expanded, options.outputPad); // configs:intercom-transcript-v1', 1),
    ],
}


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    """The exact renderer and registration must agree; never repair half a patch."""
    original = sources[MODULE] == ORIGINAL_MODULE
    previous = sources[MODULE] in (_PREVIOUS_MODULE_SOURCE, PRE_TOOL_ROW_MODULE, PRE_CHAT_ICON_MODULE)
    current = sources[MODULE] == MODULE_SOURCE
    if not original and not previous and not current:
        raise ValueError("Intercom incoming renderer changed; review upstream first")
    index = sources["index.ts"]
    if original and EDITS["index.ts"][0][1] in index:
        raise ValueError("mixed Intercom renderer registration")
    restored = replace_counted(index, EDITS["index.ts"], "Intercom registration changed:", reverse=not original)
    if not original:
        if replace_counted(restored, EDITS["index.ts"], "Intercom registration changed:") != index:
            raise ValueError("inconsistent Intercom renderer registration")
        # A stray original next to the patched registration must also refuse.
        if EDITS["index.ts"][0][0] in index:
            raise ValueError("mixed Intercom renderer registration")
        return {**sources, MODULE: MODULE_SOURCE} if previous else sources
    return {"index.ts": restored, MODULE: MODULE_SOURCE}


def main() -> None:
    root = Path(os.environ.get("PI_INTERCOM_ROOT", str(Path.home() / ".pi/agent/npm/node_modules/pi-intercom"))).expanduser()
    if not root.exists():
        print("pi-intercom not installed; skipping UI patch")
        return
    metadata = json.loads((root / "package.json").read_text())
    if metadata.get("name") != "pi-intercom" or metadata.get("version") != "0.13.0":
        raise ValueError("Intercom UI requires pi-intercom 0.13.0; review upstream first")
    sources = {name: (root / name).read_text() for name in (*EDITS, MODULE)}
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(root, sources, "intercom-ui-")
        print(f"Intercom UI backup: {backup}")
        write_sources(root, patched)
    print("Intercom UI ready; restart Pi after the matching transcript host patch")


if __name__ == "__main__":
    main()
