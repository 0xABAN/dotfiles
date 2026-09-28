#!/usr/bin/env python3
"""Select the patched, published unbundled CLI; never edit npm's minified bundle."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


PACKAGE = "@earendil-works/pi-coding-agent"
STOCK = "dist/bundle/cli.js"
CUSTOM = "dist/cli.js"
# Published private entrypoints, not an upstream compatibility guarantee.
ENTRY_HASHES = {
    CUSTOM: "8189b66abc4f9f431dbb70941dcba690d76d040de1fbfff212886be35a53639d",
    "dist/cli/setup.js": "4a2a7a0dbf82e2e5d18cec90896b36cbedce78b3d09e78d4040ac94fa3fbeba8",
}


def select_launcher(sdk: Path, launcher: Path, backup_root: Path) -> Path | None:
    """Replace only this SDK's known npm symlink, retaining its exact old target."""
    sdk = sdk.resolve(strict=True)
    # Canonicalize the parent only: macOS /tmp is itself a symlink.
    launcher = launcher.parent.resolve(strict=True) / launcher.name
    package = json.loads((sdk / "package.json").read_text())
    if package.get("name") != PACKAGE or package.get("version") != "0.87.1" or package.get("bin") != {"pi": STOCK}:
        raise ValueError("launcher requires the published Pi 0.87.1 bin contract; review upstream first")
    for name, expected in ENTRY_HASHES.items():
        if (sdk / name).is_symlink() or hashlib.sha256((sdk / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f"unrecognized CLI entry: {name}")
    for name in (STOCK, "dist/main.js", "dist/modes/interactive/interactive-mode.js"):
        if not (sdk / name).is_file():
            raise ValueError(f"missing CLI dependency: {name}")
    if not os.access(sdk / CUSTOM, os.X_OK):
        raise ValueError("unbundled CLI is not executable")
    if not launcher.is_symlink():
        raise ValueError(f"refusing non-symlink launcher: {launcher}")
    old_target = os.readlink(launcher)
    resolved = launcher.resolve(strict=True)
    if resolved not in (sdk / STOCK, sdk / CUSTOM):
        raise ValueError(f"launcher does not belong to this SDK: {launcher} -> {old_target}")
    if resolved == sdk / CUSTOM:
        print(f"Customized launcher already selected: {launcher}")
        return None

    backup_root.mkdir(parents=True, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix="pi-launcher-", dir=backup_root))
    (backup / "launcher.json").write_text(json.dumps({
        "launcher": str(launcher), "target": old_target, "sdk": str(sdk),
        "replacement": os.path.relpath(sdk / CUSTOM, launcher.parent),
    }, indent=2) + "\n")
    (backup / "pi").symlink_to(old_target)
    # Build beside the link for atomic rename; leave the original untouched on failure.
    pending = launcher.parent / f".pi-launcher-{backup.name}"
    pending.symlink_to(os.path.relpath(sdk / CUSTOM, launcher.parent))
    try:
        if not launcher.is_symlink() or os.readlink(launcher) != old_target:
            raise ValueError("launcher changed concurrently; refusing replacement")
        os.replace(pending, launcher)
    finally:
        pending.unlink(missing_ok=True)
    print(f"Customized launcher: {launcher} -> {os.readlink(launcher)}; backup: {backup}")
    return backup


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", type=Path, help="explicit installed package root")
    parser.add_argument("--launcher", type=Path, help="npm-owned pi symlink (default: PATH lookup)")
    args = parser.parse_args()
    sdk = args.sdk
    if sdk is None:
        sdk = Path(subprocess.check_output(["npm", "root", "-g"], text=True).strip()) / PACKAGE
    launcher = args.launcher or shutil.which("pi")
    if launcher is None:
        parser.error("pi launcher not found")
    select_launcher(sdk, Path(launcher), Path.home() / ".config/theme-backups")


if __name__ == "__main__":
    main()
