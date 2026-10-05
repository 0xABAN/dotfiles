#!/usr/bin/env python3
"""Mark pi-web-access page answers as one-off model calls.

`fetch_content` answer mode sends its own fixed system prompt to the current
model. Claude bridge refuses system prompts it never recorded, except calls
marked `cacheRetention: "none"`, which it serves through its isolated one-shot
path with that prompt intact. A one-off answer has nothing worth caching on any
provider, so the marker is accurate rather than bridge-specific.
"""
import json
import os
from pathlib import Path

from patch_support import backup_sources, replace_counted, write_sources

VERSION = "0.27.0"
PAGE_QUERY = "page-query.ts"
MARKER = "// configs:web-access-page-answer-v1"
EDITS = [
    ("\t}, usesRegistryComplete ? { signal, maxTokens: OUTPUT_TOKENS } "
     ": { apiKey: auth.apiKey, headers: auth.headers, signal, maxTokens: OUTPUT_TOKENS });\n",
     """\t}, {
\t\t...(usesRegistryComplete
\t\t\t? { signal, maxTokens: OUTPUT_TOKENS }
\t\t\t: { apiKey: auth.apiKey, headers: auth.headers, signal, maxTokens: OUTPUT_TOKENS }),
\t\t// configs:web-access-page-answer-v1
\t\t// One-off call: nothing to cache, and claude-bridge serves an unrecorded
\t\t// system prompt only through its isolated path, which this marker selects.
\t\tcacheRetention: "none",
\t});
""", 1),
]


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    source = sources[PAGE_QUERY]
    original = source
    if MARKER in source:
        if source.count(MARKER) != 1:
            raise ValueError("duplicated web-access page-answer marker")
        original = replace_counted(source, EDITS, "web-access page-answer anchor", reverse=True)

    # Another cache setting would make the marker's effect ambiguous; refuse it.
    if "cacheRetention" in original:
        raise ValueError("partial or conflicting web-access page-answer cache option")
    patched = replace_counted(original, EDITS, "web-access page-answer anchor")
    if MARKER in source and patched != source:
        raise ValueError("inconsistent web-access page-answer patch")
    return {**sources, PAGE_QUERY: patched}


def main() -> None:
    root = Path(os.environ.get(
        "PI_WEB_ACCESS_ROOT", str(Path.home() / ".pi/agent/npm/node_modules/pi-web-access"),
    )).expanduser()
    if not root.exists():
        print("pi-web-access not installed; skipping page-answer patch")
        return
    if json.loads((root / "package.json").read_text()).get("version") != VERSION:
        raise ValueError(f"page-answer patch requires pi-web-access {VERSION}; review upstream first")
    sources = {PAGE_QUERY: (root / PAGE_QUERY).read_text()}
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(root, sources, "web-access-page-answer-")
        print(f"Web-access page-answer backup: {backup}")
        write_sources(root, patched)
    print("Web-access page answers ready; restart Pi to apply")


if __name__ == "__main__":
    main()
