#!/usr/bin/env python3
"""Stage an exact Pi release and replay local compatibility tests; never activate it."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


PACKAGE = "@earendil-works/pi-coding-agent"
POWERLINE = Path(".pi/agent/git/github.com/nicobailon/pi-powerline-footer")
NPM_PACKAGES = Path(".pi/agent/npm/node_modules")
# Never retain credential stores, even if one was accidentally added to Git.
EXCLUDED = {"auth.json", ".npmrc", ".git", "__pycache__", ".DS_Store"}


def exact_version(value: str) -> str:
    """Accept stable numeric releases only, not npm ranges, tags, paths or options."""
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", value):
        raise argparse.ArgumentTypeError("use an exact stable version, for example 0.87.1")
    return value


def copy_tree(source: Path, target: Path) -> None:
    # Dereference links so rollback copies do not point back into live installs.
    shutil.copytree(source, target, ignore=shutil.ignore_patterns(*EXCLUDED))


def source_snapshot(repo: Path, env: dict[str, str], target: Path | None = None) -> dict[str, str]:
    """Fingerprint current tracked/untracked source, optionally copying the same bytes."""
    result = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "pi", "install.sh"],
        cwd=repo, env=env, capture_output=True, check=True,
    )
    hashes = {}
    for name in sorted(set(os.fsdecode(result.stdout).split("\0")) - {""}):
        relative = Path(name)
        if EXCLUDED.intersection(relative.parts) or relative.name.startswith("."):
            continue
        source = repo / relative
        if not source.exists():  # Locally deleted tracked files are absent from the snapshot.
            continue
        data = source.read_bytes()
        mode = source.stat().st_mode & 0o777
        hashes[name] = f"{mode:o}:{hashlib.sha256(data).hexdigest()}"
        if target is not None:
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            destination.chmod(mode)
    return hashes


def test_counts(output: str, runner: str) -> dict[str, int]:
    """Fail closed if runner summaries change, tests disappear, or any case skips."""
    output = re.sub(r"\x1b\[[0-9;]*m", "", output)
    counts = {}
    for kind in ("pass", "fail", "skip"):
        pattern = rf"(?m)^\s*(\d+) {kind}\b" if runner == "bun" else rf"(?m)^# {kind}(?:ped)? (\d+)\s*$"
        matches = re.findall(pattern, output)
        counts[kind] = sum(map(int, matches))
        if not matches and (kind != "skip" or runner == "node"):
            raise RuntimeError(f"missing {runner} {kind} summary; coverage is unknown")
    if not counts["pass"] or counts["fail"] or counts["skip"]:
        raise RuntimeError(f"incomplete {runner} coverage: {counts}")
    return counts


def check_upgrade(version: str, backup: bool, repo: Path, home: Path, stage: Path) -> int:
    """All writes stay in stage (or the tests' own temporary fixtures)."""
    report = {
        "version": version, "status": "failed", "activated": False, "backup_complete": False,
        "coverage": {},
        "scope": "Local config/native suites and clean launcher/auth tests with synthetic tokens. "
                 "Real CLI terminal checks cover pi-pretty, Powerline, the configured theme and real Intercom renderers "
                 "with synthetic registration/delivery (no broker) in both modes. "
                 "Not every personal extension, upstream suites or authenticated model calls.",
    }
    isolated_home = stage / "home"
    isolated_home.mkdir()
    for directory in ("tmp", "cache", "config"):
        (stage / directory).mkdir()
    env = {
        "PATH": os.environ.get("PATH", os.defpath), "HOME": str(isolated_home),
        "USERPROFILE": str(isolated_home), "TMPDIR": str(stage / "tmp"),
        "XDG_CONFIG_HOME": str(stage / "config"), "XDG_CACHE_HOME": str(stage / "cache"),
        "PI_OFFLINE": "1", "PI_TELEMETRY": "0", "PYTHONDONTWRITEBYTECODE": "1",
        "FORCE_COLOR": "0", "TERM": "dumb",
        "npm_config_userconfig": str(stage / "user.npmrc"),
        "npm_config_globalconfig": str(stage / "global.npmrc"),
        "npm_config_cache": str(stage / "cache/npm"),
    }

    def run(name: str, args: list[str], cwd: Path) -> str:
        log = stage / f"{name}.log"
        print(f"{name}: {log}", flush=True)
        with log.open("w") as output:
            output.write(json.dumps(args) + "\n")
            output.flush()
            result = subprocess.run(args, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT)
        if result.returncode:
            raise RuntimeError(f"{name} failed ({result.returncode}); see {log}")
        return log.read_text()

    try:
        report["source_head"] = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=repo, env=env, capture_output=True, text=True, check=True,
        ).stdout.strip()
        snapshot = stage / "source"
        hashes = source_snapshot(repo, env, snapshot)
        (stage / "source-hashes.json").write_text(json.dumps(hashes, indent=2) + "\n")
        report["source_snapshot"] = str(snapshot)

        # Package resolution has one HOME-based test, so reproduce just the package
        # locations there, not personal settings, sessions or credential stores.
        for relative in (NPM_PACKAGES, POWERLINE):
            copy_tree(home / relative, isolated_home / relative)
        required = [POWERLINE, *(NPM_PACKAGES / name for name in (
            "@juicesharp/rpiv-todo", "@tintinweb/pi-subagents", "@heyhuynhgiabuu/pi-pretty", "pi-intercom",
        ))]
        report["package_sources"] = {}
        for relative in required:
            package = isolated_home / relative / "package.json"
            metadata = json.loads(package.read_text())  # Missing sources must fail, not skip.
            report["package_sources"][str(home / relative)] = metadata.get("version")

        clean = snapshot / "pi/clean"
        # Do not reuse the old lockfile: this is a separate, exact candidate install.
        (clean / "package-lock.json").unlink(missing_ok=True)
        (clean / "package.json").write_text(json.dumps({"private": True, "dependencies": {}}) + "\n")
        run("install", ["npm", "install", "--ignore-scripts", "--save-exact", "--no-audit", "--no-fund",
                        "--registry=https://registry.npmjs.org", f"{PACKAGE}@{version}"], clean)
        sdk = clean / "node_modules" / PACKAGE
        if json.loads((sdk / "package.json").read_text()).get("version") != version:
            raise RuntimeError("installed version differs from requested version")
        env["PI_SDK_ROOT"] = str(sdk)
        report["coverage"]["config"] = test_counts(
            run("config-tests", ["bun", "test", "pi/agent/tests"], snapshot), "bun",
        )
        report["coverage"]["clean"] = test_counts(
            run("clean-tests", ["node", "--test", "--test-reporter=tap", "pi-clean.test.mjs", "auth-store.test.mjs"], clean), "node",
        )
        # Native tests patch disposable fixtures, not the candidate itself. Replay
        # into this candidate only after the unmodified clean-launcher tests pass.
        for patcher in ("powerline-dj", "powerline-layout", "powerline-compaction-queue", "pi-horizontal-inset", "powerline-editor",
                        "pi-markdown-code", "pi-transcript", "intercom-ui", "pi-extension-dialogs", "pi-activity-notices",
                        "pi-compact-layout", "pi-editor-gap", "pi-compaction-queue"):
            run(patcher, ["python3", "-B", f"pi/agent/patches/{patcher}.py"], snapshot)
        candidate_launcher = clean / "node_modules/.bin/pi"
        run("select-launcher", ["python3", "-B", "pi/launcher.py", "--sdk", str(sdk),
                                "--launcher", str(candidate_launcher)], snapshot)
        run("cli-smoke", ["python3", "-B", "pi/cli_smoke.py", "--sdk", str(sdk),
                          "--launcher", str(candidate_launcher), "--config", str(snapshot),
                          "--home", str(isolated_home), "--output", str(stage / "cli-smoke")], snapshot)
        cli_checks = json.loads((stage / "cli-smoke/assertions.json").read_text())
        if set(cli_checks) != {"regular", "fullscreen"} or any(
            not checks or not all(value is True for value in checks.values()) for checks in cli_checks.values()
        ):
            raise RuntimeError("incomplete actual-CLI rendering coverage")
        report["coverage"]["cli"] = cli_checks
        report["candidate_launcher"] = {"path": str(candidate_launcher), "target": os.readlink(candidate_launcher)}
        if source_snapshot(repo, env) != hashes:
            raise RuntimeError("configuration changed during checks; rerun before using this result")

        # Record the real executable, not just npm's package directory. Unknown
        # wrappers/other installations need review before a safe activation plan.
        output = run("global-root", ["npm", "root", "-g"], stage)
        global_root = (Path(output.splitlines()[-1]) / PACKAGE).resolve()
        live_command = shutil.which("pi", path=env["PATH"])
        if not live_command:
            raise RuntimeError("live pi command not found")
        live_launcher = Path(live_command)
        if not live_launcher.is_symlink() or live_launcher.resolve() not in (
            global_root / "dist/bundle/cli.js", global_root / "dist/cli.js",
        ):
            raise RuntimeError(f"unrecognized live launcher: {live_launcher}; review activation manually")
        report["live_launcher"] = {"path": str(live_launcher), "target": os.readlink(live_launcher)}
        if backup:
            rollback = stage / "rollback"
            rollback.mkdir()
            for source, destination in ((global_root, "global-pi"), (repo / "pi/clean", "pi-clean"),
                                        (home / POWERLINE, "powerline"),
                                        (home / NPM_PACKAGES / "pi-intercom", "intercom")):
                copy_tree(source, rollback / destination)
            (rollback / "launcher.json").write_text(json.dumps(report["live_launcher"], indent=2) + "\n")
            (rollback / "pi-launcher").symlink_to(report["live_launcher"]["target"])
            report["backup_complete"] = True
            report["backup_sources"] = {"global-pi": str(global_root), "pi-clean": str(repo / "pi/clean"),
                                        "powerline": str(home / POWERLINE), "intercom": str(home / NPM_PACKAGES / "pi-intercom")}
        if source_snapshot(repo, env) != hashes:
            raise RuntimeError("configuration changed while backing up; rerun before activation")
        report["status"] = "passed"
        print("Compatibility checks passed; no live installation changed. Activation remains manual.")
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        report["error"] = str(error)
        print(f"STOP: {error}", file=sys.stderr)
        return 1
    finally:
        (stage / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        print(f"Retained stage and report: {stage}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", type=exact_version, help="exact stable release, e.g. 0.87.1")
    parser.add_argument("--backup", action="store_true", help="after green checks, copy rollback material; never activate")
    args = parser.parse_args()
    # Ignore inherited TMPDIR; private stage lives outside configured projects.
    stage = Path(tempfile.mkdtemp(prefix=f"pi-upgrade-{args.version}-", dir="/tmp")).resolve()
    return check_upgrade(args.version, args.backup, Path(__file__).resolve().parent.parent, Path.home(), stage)


if __name__ == "__main__":
    raise SystemExit(main())
