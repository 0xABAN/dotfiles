#!/usr/bin/env python3
"""Use JEV_API_KEY directly with pi-jev-router 0.4.0; leave Codex dispatch intact."""
import json
import os
from pathlib import Path

from patch_support import backup_sources, read_payload, replace_counted, write_sources

MODULE = "jev-direct.ts"
MODULE_SOURCE = read_payload("jev/direct-evaluate.ts.inc")
IMPORT = 'import { evaluate } from "./jev-direct.ts"; // configs:jev-direct-v1'
EDITS = [
    ('import { createGateway, experimental_evaluate as evaluate } from "ai";', IMPORT, 1),
    ('const GATEWAY = "vercel-ai-gateway";\n', "", 1),
    ('JSON.stringify({ state, questions, providerOptions: {} })',
     'JSON.stringify({ model: "jev-latest", state, questions })', 1),
    ('baseUrl: "https://ai-gateway.vercel.sh",', 'baseUrl: "https://api.typesafe.ai",', 1),
    ('evaluate({ model, state', 'evaluate({ state', 3),
    (', maxRetries: 0', '', 3),
    ('Gateway rejected credentials (401); update the Gateway key',
     'Jev rejected credentials (401); update JEV_API_KEY and restart Pi', 1),
    ('Jev unavailable; check Gateway login/key and connectivity',
     'Jev unavailable; check JEV_API_KEY in Pi environment and connectivity', 1),
    ('const gateway = ctx.modelRegistry.getProviderAuthStatus(GATEWAY).configured ? "configured" : "missing: /login vercel-ai-gateway";',
     'const connection = process.env.JEV_API_KEY?.trim() ? "direct (JEV_API_KEY configured)" : "direct (missing JEV_API_KEY; export it and restart Pi)";', 1),
    (r'\nGateway: ${gateway}', r'\nJev API: ${connection}', 1),
]
# All three evaluation paths (routing/monitoring, skills, adaptive effort) must
# stop resolving Gateway auth. Codex authentication remains owned by Pi.
for indent in ("\t\t\t", "\t\t\t\t\t", "\t\t\t\t"):
    EDITS.append((
        f'{indent}const auth = await abortable(() => ctx.modelRegistry.getProviderAuth(GATEWAY), signal);\n'
        f'{indent}if (!auth?.auth.apiKey) throw new Error("missing Gateway key");\n'
        f'{indent}const model = createGateway({{ apiKey: auth.auth.apiKey }}).evaluationModel("typesafe-ai/jev");\n',
        "", 1,
    ))


def patch_sources(sources: dict[str, str]) -> dict[str, str]:
    """Validate every transport anchor and companion before making any writes."""
    index = sources["index.ts"]
    if IMPORT in index:
        if sources.get(MODULE) != MODULE_SOURCE:
            raise ValueError("Jev direct helper missing or modified; refusing partial patch")
        for old, new, count in EDITS:
            if old in index or (new and index.count(new) != count):
                raise ValueError("Jev direct entrypoint changed; review upstream first")
        return sources
    if MODULE in sources:
        raise ValueError("Jev direct helper already exists without its registration")
    return {"index.ts": replace_counted(index, EDITS, "Jev transport changed:"), MODULE: MODULE_SOURCE}


def main() -> None:
    root = Path(os.environ.get("PI_JEV_ROOT", str(Path.home() / ".pi/agent/npm/node_modules/pi-jev-router"))).expanduser()
    if not root.exists():
        print("pi-jev-router not installed; skipping direct API patch")
        return
    metadata = json.loads((root / "package.json").read_text())
    if metadata.get("name") != "pi-jev-router" or metadata.get("version") != "0.4.0":
        raise ValueError("Jev direct API patch requires pi-jev-router 0.4.0; review upstream first")
    sources = {"index.ts": (root / "index.ts").read_text()}
    if (root / MODULE).exists():
        sources[MODULE] = (root / MODULE).read_text()
    patched = patch_sources(sources)
    if patched != sources:
        backup = backup_sources(root, sources, "jev-direct-", added_files=[MODULE])
        print(f"Jev direct API backup: {backup}")
        write_sources(root, patched)
    print("Jev direct API ready; export JEV_API_KEY before starting Pi, then /reload")


if __name__ == "__main__":
    main()
