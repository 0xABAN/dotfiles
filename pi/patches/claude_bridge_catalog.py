#!/usr/bin/env python3
"""List the Claude models Pi knows about, not only those its pi-ai release shipped.

Claude bridge builds its picker from pi-ai's static Anthropic catalog, which is
frozen when the host Pi is published. Pi's own `anthropic` provider overlays the
pi.dev catalog it refreshes into `models-store.json`; that overlay is how
`claude-haiku-5-5` reaches Pi 1.0.0. The bridge applies the same overlay with
Pi's staleness rule, so both providers list the same models. A model the bridge
has not measured for 1M context still runs at the bridge's 200K default.
"""
import json
import os
from pathlib import Path

from patch_support import backup_sources, replace_counted, write_sources

VERSION = "0.9.1"
INDEX = "src/index.ts"
MARKER = "// configs:claude-bridge-catalog-v1"
EDITS = [
    ('import { getModels } from "@earendil-works/pi-ai/compat";\n',
     'import { getModels, isModelType } from "@earendil-works/pi-ai/compat";\n'
     'import { getBuiltinModelDataGeneratedAt } from "@earendil-works/pi-ai/providers/all";\n', 1),
    ("import { buildSessionContext, compact, generateBranchSummary, keyHint, ",
     "import { buildSessionContext, compact, generateBranchSummary, getAgentDir, keyHint, ", 1),
    ('import { appendFileSync, mkdirSync, realpathSync, statSync } from "fs";\n',
     'import { appendFileSync, mkdirSync, readFileSync, realpathSync, statSync } from "fs";\n', 1),
    ("""// MODELS is buildModels(getModels("anthropic")) — projection kept in models.js.
const MODELS = buildModels(getModels("anthropic"));
""",
     """// configs:claude-bridge-catalog-v1
// Pi overlays the pi.dev catalog it refreshes into models-store.json on pi-ai's
// static one, which is how Claude models newer than the host Pi release reach
// its anthropic provider. Apply the same overlay so this picker matches.
function anthropicCatalog() {
\tconst builtin = getModels("anthropic");
\tconst storePath = join(getAgentDir(), "models-store.json");

\tlet stored: { models: any[]; lastModified?: number } | undefined;
\ttry {
\t\tstored = JSON.parse(readFileSync(storePath, "utf-8")).anthropic;
\t} catch (err) {
\t\t// No store: Pi has never refreshed a catalog, so the static one is all it has.
\t\tif ((err as NodeJS.ErrnoException).code === "ENOENT") return builtin;
\t\tthrow new Error(`claude-bridge: cannot read ${storePath}: ${errorMessage(err)}`);
\t}
\tif (!stored) return builtin;

\t// Pi's remote-catalog rules: an overlay no newer than the static data is stale,
\t// only chat models count, and overlay entries replace static ones by id.
\tconst generatedAt = getBuiltinModelDataGeneratedAt();
\tif (generatedAt !== undefined && (stored.lastModified === undefined || stored.lastModified <= generatedAt)) {
\t\treturn builtin;
\t}
\tconst overlay = stored.models.filter((m) => m.provider === "anthropic" && isModelType(m, "chat"));
\tconst byId = new Map([...builtin, ...overlay].map((m) => [m.id, m]));
\treturn [...byId.values()];
}

// MODELS is buildModels(anthropicCatalog()) — projection kept in models.js.
const MODELS = buildModels(anthropicCatalog());
""", 1),
]


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    source = sources[INDEX]
    original = source
    if MARKER in source:
        if source.count(MARKER) != 1:
            raise ValueError("duplicated claude-bridge catalog marker")
        original = replace_counted(source, EDITS, "claude-bridge catalog anchor", reverse=True)

    # Upstream reading the store itself would make a second overlay redundant; refuse it.
    if "models-store.json" in original:
        raise ValueError("partial or conflicting claude-bridge catalog overlay")
    patched = replace_counted(original, EDITS, "claude-bridge catalog anchor")
    if MARKER in source and patched != source:
        raise ValueError("inconsistent claude-bridge catalog patch")
    return {**sources, INDEX: patched}


def main() -> None:
    root = Path(os.environ.get(
        "PI_CLAUDE_BRIDGE_ROOT", str(Path.home() / ".pi/agent/npm/node_modules/pi-claude-bridge"),
    )).expanduser()
    if not root.exists():
        print("pi-claude-bridge not installed; skipping catalog patch")
        return
    if json.loads((root / "package.json").read_text()).get("version") != VERSION:
        raise ValueError(f"catalog patch requires pi-claude-bridge {VERSION}; review upstream first")
    sources = {INDEX: (root / INDEX).read_text()}
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(root, sources, "claude-bridge-catalog-")
        print(f"Claude-bridge catalog backup: {backup}")
        write_sources(root, patched)
    print("Claude-bridge catalog overlay ready; /reload Pi to apply")


if __name__ == "__main__":
    main()
