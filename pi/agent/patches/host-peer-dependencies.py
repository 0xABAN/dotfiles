#!/usr/bin/env python3
"""Repair installed extension manifests without hiding Pi's dependency warnings."""
import argparse
import json
from pathlib import Path

from patch_support import backup_sources, write_sources

PACKAGES = {
    "@tintinweb/pi-subagents": "0.19.0",
    "@juicesharp/rpiv-ask-user-question": "2.9.0",
    "pi-web-access": "0.27.0",
    "@juicesharp/rpiv-todo": "2.9.0",
}
HOST_PROVIDED = {
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
    "@sinclair/typebox",
    "typebox",
}


def patch_manifest(source: str, name: str, version: str) -> str:
    """Move host dependencies to wildcard peers, preserving all other metadata."""
    manifest = json.loads(source)
    if manifest.get("name") != name or manifest.get("version") != version:
        raise ValueError(f"host peers require {name}@{version}; review upstream first")
    dependencies = manifest.get("dependencies", {})
    peers = manifest.setdefault("peerDependencies", {})
    if not isinstance(dependencies, dict) or not isinstance(peers, dict):
        raise ValueError(f"invalid dependency maps in {name}")
    if "typebox" not in dependencies and "typebox" not in peers:
        raise ValueError(f"TypeBox declaration missing from {name}; review upstream first")

    for package in sorted(HOST_PROVIDED.intersection(dependencies.keys() | peers.keys())):
        dependencies.pop(package, None)
        peers[package] = "*"
    if manifest == json.loads(source):
        return source
    return json.dumps(manifest, indent=2) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify without writing")
    args = parser.parse_args()
    root = Path.home() / ".pi/agent/npm/node_modules"
    changes = {}
    # Validate every installed target before backing up or changing any manifest.
    for name, version in PACKAGES.items():
        relative = f"{name}/package.json"
        if not (root / name).exists():
            continue
        source = (root / relative).read_text()
        patched = patch_manifest(source, name, version)
        if patched != source:
            changes[relative] = patched

    if args.check and changes:
        raise SystemExit("Host peer declarations need repair: " + ", ".join(changes))
    if changes:
        backup = backup_sources(root, changes, "pi-host-peers-")
        print(f"Extension manifest backup: {backup}")
        write_sources(root, changes)
    print("Installed extension host peers verified; /reload Pi after repairs")


if __name__ == "__main__":
    main()
