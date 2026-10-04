"""Shared patch mechanics, not compatibility policy.

Callers validate their complete source set before backing up or writing it.
Versions, accepted migrations, diagnostics and installation order stay local.
"""
from collections.abc import Iterable, Mapping, Sequence
import json
import os
from pathlib import Path
import shutil
import tempfile


def read_payload(name: str) -> str:
    """Read owned renderer source verbatim; whitespace is part of patch identity."""
    return (Path(__file__).with_name("payloads") / name).read_text()


def discover_pi_root() -> Path | None:
    """Locate the active Pi command, not an unrelated Node/npm installation."""
    if os.environ.get("PI_SDK_ROOT"):
        return Path(os.environ["PI_SDK_ROOT"]).expanduser()
    launcher = shutil.which("pi")
    if launcher is None:
        return None
    for root in Path(launcher).resolve(strict=True).parents:
        manifest = root / "package.json"
        if manifest.is_file() and json.loads(manifest.read_text()).get("name") == "@earendil-works/pi-coding-agent":
            return root
    raise ValueError(f"cannot locate the Pi package owning {launcher}; set PI_SDK_ROOT explicitly")


def backup_sources(
    root: Path,
    names: Iterable[str],
    prefix: str,
    *,
    added_files: list[str] | None = None,
) -> Path:
    """Copy every original before a caller writes; optionally record new files.

    None preserves patchers that never wrote a manifest. An empty list creates
    an empty manifest, which is a distinct existing installation contract.
    """
    backup_root = Path.home() / ".config/theme-backups"
    backup_root.mkdir(parents=True, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix=prefix, dir=backup_root))
    for name in names:
        target = backup / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / name, target)
    if added_files is not None:
        (backup / "added-files.json").write_text(json.dumps(added_files) + "\n")
    return backup


def write_sources(root: Path, sources: Mapping[str, str]) -> None:
    """Write the caller's validated sources in their original order."""
    for name, source in sources.items():
        (root / name).write_text(source)


def replace_counted(
    source: str,
    edits: Sequence[tuple[str, str, int]],
    error_prefix: str,
    *,
    reverse: bool = False,
) -> str:
    """Apply ordered exact replacements, reversing their order when undoing them."""
    ordered_edits = reversed(edits) if reverse else edits
    for old, new, count in ordered_edits:
        before, after = (new, old) if reverse else (old, new)
        if source.count(before) != count:
            raise ValueError(f"{error_prefix} {before[:80]!r}")
        source = source.replace(before, after)
    return source
