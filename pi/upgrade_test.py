"""Offline orchestration checks; actual native compatibility is tested by upgrade.py."""

import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("upgrade", Path(__file__).with_name("upgrade.py"))
upgrade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upgrade)


class UpgradeTest(unittest.TestCase):
    def test_version_rejects_npm_specs_before_staging(self):
        self.assertEqual(upgrade.exact_version("0.85.1"), "0.85.1")
        for value in ("latest", "^0.85.1", "0.85", "01.2.3", "0.85.1-beta.1", "--global", "file:/tmp/pkg", "0.85.1;touch bad", "0.85.1\n"):
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                upgrade.exact_version(value)

    def test_isolated_green_run_backup_and_failure_gates(self):
        # Exercise the real filesystem orchestration with controlled subprocesses.
        for failure in (
            None, "install", "config", "clean", "skip", "missing-summary", "source-change",
            "backup", "no-backup", "cli", "launcher", "cli-assertions", "foreign-launcher",
            "intercom", "compaction-queue", "powerline-queue", "markdown-code", "editor-gap",
        ):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                repo, home, stage, global_modules = (root / name for name in ("repo", "home", "stage", "global"))
                stage.mkdir(mode=0o700)
                files = {
                    repo / "pi/agent/patches/guard.py": "exact version guard",
                    repo / "pi/clean/package.json": "{}",
                    repo / "pi/clean/package-lock.json": "old lock",
                    repo / "pi/clean/pi-clean": "launcher",
                    repo / "pi/clean/auth_store.mjs": "adapter",
                    repo / "pi/clean/node_modules/installed.txt": "live clean install",
                    home / upgrade.POWERLINE / "package.json": '{"version":"1.0.0"}',
                    home / upgrade.POWERLINE / "index.ts": "original editor",
                    home / upgrade.POWERLINE / "bash-mode/editor.ts": "original bash editor",
                    home / ".pi/agent/auth.json": "DO NOT READ OR COPY",
                    global_modules / upgrade.PACKAGE / "original.txt": "live global install",
                }
                for name in ("@juicesharp/rpiv-todo", "@tintinweb/pi-subagents", "pi-intercom"):
                    files[home / upgrade.NPM_PACKAGES / name / "package.json"] = '{"version":"1.0.0"}'
                for path, text in files.items():
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(text)
                # Copying rollback material must not retain mutable links to live files.
                (global_modules / upgrade.PACKAGE / "alias.txt").symlink_to("original.txt")
                (repo / "pi/clean/auth.json").write_text("also excluded from backup")
                live_launcher = root / "bin/pi"
                live_launcher.parent.mkdir()
                live_launcher.symlink_to(global_modules / upgrade.PACKAGE / "dist/bundle/cli.js")
                if failure == "foreign-launcher":
                    live_launcher.unlink()
                    live_launcher.symlink_to("/bin/sh")
                calls = []

                def fake_run(args, *, cwd, env, **kwargs):
                    calls.append(args)
                    self.assertEqual(env["HOME"], str(stage / "home"))
                    self.assertNotEqual(env["npm_config_userconfig"], env["npm_config_globalconfig"], "npm refuses loading one file in two roles")
                    for name in ("OPENAI_API_KEY", "NODE_OPTIONS", "PI_CLEAN_AUTH_PATH", "PI_CODING_AGENT_DIR", "npm_config_prefix"):
                        self.assertNotIn(name, env)
                    if args[:2] == ["git", "rev-parse"]:
                        return subprocess.CompletedProcess(args, 0, "fixture-head\n")
                    if args[:2] == ["git", "ls-files"]:
                        names = [str(p.relative_to(repo)) for p in repo.rglob("*") if p.is_file() and "node_modules" not in p.parts]
                        return subprocess.CompletedProcess(args, 0, "\0".join(names).encode())
                    self.assertTrue(Path(cwd).is_relative_to(stage), (args, cwd))
                    code, output = 0, ""
                    if args[:2] == ["npm", "install"]:
                        self.assertIn("--ignore-scripts", args)
                        self.assertIn("--save-exact", args)
                        self.assertNotIn("-g", args)
                        self.assertNotIn("--global", args)
                        self.assertEqual(args[-1], upgrade.PACKAGE + "@0.85.1")
                        sdk = Path(cwd) / "node_modules" / upgrade.PACKAGE
                        sdk.mkdir(parents=True)
                        (sdk / "package.json").write_text('{"version":"0.85.1"}')
                        (sdk.parent.parent / ".bin").mkdir()
                        (sdk.parent.parent / ".bin/pi").symlink_to(sdk / "dist/bundle/cli.js")
                        code = 1 if failure == "install" else 0
                    elif args[:2] == ["bun", "test"]:
                        self.assertTrue(Path(env["PI_SDK_ROOT"]).is_relative_to(stage))
                        self.assertEqual((stage / "home" / upgrade.POWERLINE / "index.ts").read_text(), "original editor")
                        self.assertFalse((stage / "home/.pi/agent/auth.json").exists())
                        code = 1 if failure == "config" else 0
                        output = "90 pass\n0 fail\n" + ("1 skip\n" if failure == "skip" else "")
                        if failure == "missing-summary":
                            output = "nothing ran\n"
                    elif args[:2] == ["node", "--test"]:
                        self.assertIn("auth_store.test.mjs", args)
                        code = 1 if failure == "clean" else 0
                        output = "# pass 3\n# fail 0\n# skipped 0\n"
                        if failure == "source-change":
                            (repo / "pi/agent/patches/guard.py").write_text("edited concurrently")
                    elif args[:2] == ["python3", "-B"]:
                        self.assertTrue(Path(env["PI_SDK_ROOT"]).is_relative_to(stage))
                        if args[2] == "pi/launcher.py":
                            link = Path(args[args.index("--launcher") + 1])
                            self.assertTrue(link.is_relative_to(stage))
                            link.unlink()
                            link.symlink_to(Path(env["PI_SDK_ROOT"]) / "dist/cli.js")
                            code = 1 if failure == "launcher" else 0
                        elif args[2] == "pi/cli_smoke.py":
                            code = 1 if failure == "cli" else 0
                            directory = stage / "cli-smoke"
                            directory.mkdir()
                            (directory / "assertions.json").write_text(json.dumps({
                                "regular": {"rendered": failure != "cli-assertions"}, "fullscreen": {"rendered": True},
                            }))
                        else:
                            self.assertTrue(args[2].startswith("pi/agent/patches/"))
                            if args[2] == "pi/agent/patches/intercom_ui.py":
                                code = 1 if failure == "intercom" else 0
                            if args[2] == "pi/agent/patches/pi_compaction_queue.py":
                                code = 1 if failure == "compaction-queue" else 0
                            if args[2] == "pi/agent/patches/powerline_compaction_queue.py":
                                code = 1 if failure == "powerline-queue" else 0
                            for name in ("markdown-code", "editor-gap"):
                                if args[2] == f"pi/agent/patches/pi-{name}.py":
                                    code = 1 if failure == name else 0
                    elif args == ["npm", "root", "-g"]:
                        output = str(global_modules) + "\n"
                        if failure == "backup":
                            (global_modules / upgrade.PACKAGE / "original.txt").unlink()
                    else:
                        self.fail(f"unexpected subprocess: {args}")
                    kwargs["stdout"].write(output)
                    return subprocess.CompletedProcess(args, code)

                with patch.object(upgrade.subprocess, "run", side_effect=fake_run), \
                     patch.object(upgrade.shutil, "which", return_value=str(live_launcher)), \
                     patch.dict(os.environ, {"OPENAI_API_KEY": "secret", "NODE_OPTIONS": "unsafe", "npm_config_prefix": "unsafe"}), \
                     contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    result = upgrade.check_upgrade("0.85.1", failure != "no-backup", repo, home, stage)
                report = json.loads((stage / "report.json").read_text())
                green = failure in (None, "no-backup")
                self.assertEqual(result, 0 if green else 1, report)
                self.assertEqual(report["status"], "passed" if green else "failed")
                self.assertFalse(report["activated"])
                self.assertIn("synthetic tokens", report["scope"])
                self.assertIn("Real CLI terminal", report["scope"])
                self.assertEqual(report["source_head"], "fixture-head")
                if failure in ("install", "config", "skip", "missing-summary"):
                    self.assertFalse(any(command[:2] == ["node", "--test"] for command in calls))
                if not green and failure != "backup":
                    self.assertFalse((stage / "rollback").exists())
                    if failure != "foreign-launcher":
                        self.assertNotIn(["npm", "root", "-g"], calls)
                if failure == "no-backup":
                    self.assertFalse(report["backup_complete"])
                    self.assertFalse((stage / "rollback").exists())
                if failure is None:
                    self.assertEqual(report["coverage"], {"config": {"pass": 90, "fail": 0, "skip": 0}, "clean": {"pass": 3, "fail": 0, "skip": 0}, "cli": {"regular": {"rendered": True}, "fullscreen": {"rendered": True}}})
                    self.assertTrue(report["backup_complete"])
                    rollback = stage / "rollback"
                    self.assertEqual((rollback / "powerline/bash-mode/editor.ts").read_text(), "original bash editor")
                    self.assertTrue((rollback / "intercom/package.json").exists())
                    self.assertIn(["python3", "-B", "pi/agent/patches/intercom_ui.py"], calls)
                    self.assertIn(["python3", "-B", "pi/agent/patches/pi_compaction_queue.py"], calls)
                    self.assertIn(["python3", "-B", "pi/agent/patches/powerline_compaction_queue.py"], calls)
                    self.assertIn(["python3", "-B", "pi/agent/patches/pi_markdown_code.py"], calls)
                    self.assertIn(["python3", "-B", "pi/agent/patches/pi_editor_gap.py"], calls)
                    self.assertEqual((rollback / "pi-clean/node_modules/installed.txt").read_text(), "live clean install")
                    self.assertFalse((rollback / "global-pi/alias.txt").is_symlink())
                    self.assertFalse(list(rollback.rglob("auth.json")))
                    self.assertEqual(os.readlink(rollback / "pi-launcher"), os.readlink(live_launcher))
                    self.assertEqual(json.loads((rollback / "launcher.json").read_text())["path"], str(live_launcher))
                    (rollback / "global-pi/alias.txt").write_text("independent backup")
                for path, text in files.items():
                    if failure == "source-change" and path.name == "guard.py":
                        continue
                    if failure == "backup" and path.name == "original.txt":
                        continue
                    self.assertEqual(path.read_text(), text, f"live file modified: {path}")


if __name__ == "__main__":
    unittest.main()
