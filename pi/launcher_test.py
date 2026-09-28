"""Launcher changes must preserve npm ownership and refuse unknown installations."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("launcher", Path(__file__).with_name("launcher.py"))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

CLI = '''#!/usr/bin/env node
import { setupCli } from "./cli/setup.js";
import { main } from "./main.js";
setupCli();
main(process.argv.slice(2));
//# sourceMappingURL=cli.js.map'''
SETUP = '''import { APP_NAME } from "../config.js";
import { configureHttpDispatcher } from "../core/http-dispatcher.js";
export function setupCli() {
    process.title = APP_NAME;
    process.env.PI_CODING_AGENT = "true";
    process.env.AI_AGENT = "pi";
    process.emitWarning = (() => { });
    // Configure undici before provider SDKs issue requests. Settings are applied
    // once SettingsManager has loaded global/project configuration.
    configureHttpDispatcher();
}
//# sourceMappingURL=setup.js.map'''


class LauncherTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.sdk = self.root / "sdk"
        for name, content in {
            "package.json": json.dumps({"name": launcher.PACKAGE, "version": "0.87.1", "bin": {"pi": launcher.STOCK}}),
            launcher.CUSTOM: CLI, "dist/cli/setup.js": SETUP, launcher.STOCK: "stock bundle",
            "dist/main.js": "main", "dist/modes/interactive/interactive-mode.js": "host",
        }.items():
            path = self.sdk / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        (self.sdk / launcher.CUSTOM).chmod(0o755)
        self.link = self.root / "bin/pi"
        self.link.parent.mkdir()
        self.link.symlink_to("../sdk/" + launcher.STOCK)
        self.backups = self.root / "backups"

    def apply(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return launcher.select_launcher(self.sdk, self.link, self.backups)

    def test_exact_backup_idempotence_and_npm_reset(self):
        old = os.readlink(self.link)
        before = {str(p): p.read_bytes() for p in self.sdk.rglob("*") if p.is_file()}
        backup = self.apply()
        self.assertEqual(os.readlink(backup / "pi"), old)
        record = json.loads((backup / "launcher.json").read_text())
        self.assertEqual(record["target"], old)
        self.assertEqual(record["launcher"], str(self.link))
        self.assertEqual(self.link.resolve(), self.sdk / launcher.CUSTOM)
        self.assertIsNone(self.apply())
        self.assertEqual(len(list(self.backups.iterdir())), 1)
        # npm reinstalls its declared bin target; replay restores our choice.
        self.link.unlink()
        self.link.symlink_to(old)
        self.assertIsNotNone(self.apply())
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.sdk.rglob("*") if p.is_file()})

    def test_parent_symlink_does_not_break_relative_target(self):
        alias = self.root / "alias"
        alias.symlink_to(self.link.parent, target_is_directory=True)
        self.link = alias / "pi"
        self.apply()
        self.assertEqual(self.link.resolve(), self.sdk / launcher.CUSTOM)

    def test_refuses_modified_entry_before_backup(self):
        (self.sdk / launcher.CUSTOM).write_text(CLI + "\n// local change")
        with self.assertRaisesRegex(ValueError, "unrecognized CLI"):
            self.apply()
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.link.resolve(), self.sdk / launcher.STOCK)

    def test_refuses_version_bin_missing_dependency_and_nonexecutable(self):
        package = self.sdk / "package.json"
        original = package.read_text()
        for key, value in (("version", "0.85.2"), ("bin", {"pi": launcher.CUSTOM})):
            metadata = json.loads(original)
            metadata[key] = value
            package.write_text(json.dumps(metadata))
            with self.assertRaises(ValueError):
                self.apply()
            package.write_text(original)
        (self.sdk / "dist/main.js").unlink()
        with self.assertRaisesRegex(ValueError, "missing CLI"):
            self.apply()
        (self.sdk / "dist/main.js").write_text("main")
        (self.sdk / launcher.CUSTOM).chmod(0o644)
        with self.assertRaisesRegex(ValueError, "not executable"):
            self.apply()
        self.assertFalse(self.backups.exists())

    def test_refuses_foreign_link_and_regular_file(self):
        self.link.unlink()
        self.link.symlink_to("/bin/sh")
        with self.assertRaisesRegex(ValueError, "does not belong"):
            self.apply()
        self.link.unlink()
        self.link.write_text("user wrapper")
        with self.assertRaisesRegex(ValueError, "non-symlink"):
            self.apply()
        self.assertEqual(self.link.read_text(), "user wrapper")
        self.assertFalse(self.backups.exists())

    def test_failed_atomic_replace_preserves_original_and_backup(self):
        old = os.readlink(self.link)
        with patch.object(launcher.os, "replace", side_effect=PermissionError("denied")), self.assertRaises(PermissionError):
            self.apply()
        self.assertEqual(os.readlink(self.link), old)
        backup = next(self.backups.iterdir())
        self.assertEqual(os.readlink(backup / "pi"), old)
        self.assertEqual(list(self.link.parent.iterdir()), [self.link])


if __name__ == "__main__":
    unittest.main()
