import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

// A fake Pi entry point reports exactly what the launcher passes to its child.
// This checks isolation without loading real extensions or making model calls.
test("isolates each run, forwards arguments, cleans up and preserves failures", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-clean-test-"));
  try {
    const launcher = join(root, "pi-clean");
    copyFileSync(new URL("./pi-clean", import.meta.url), launcher);
    chmodSync(launcher, 0o755);
    copyFileSync(new URL("./auth_store.mjs", import.meta.url), join(root, "auth_store.mjs"));
    const cli = join(root, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
    mkdirSync(join(dirname(cli), "core"), { recursive: true });
    writeFileSync(join(dirname(cli), "core/auth-storage.js"), "export class AuthStorage { static create(authPath) { return { authPath }; } }\n");
    writeFileSync(cli, `
      const fs = require("node:fs");
      const authPath = require("node:path").join(process.env.PI_CODING_AGENT_DIR, "auth.json");
      const auth = fs.existsSync(authPath) ? JSON.parse(fs.readFileSync(authPath, "utf8")) : {};
      fs.writeFileSync(authPath, JSON.stringify({ count: (auth.count ?? 0) + 1 }));
      const fd = require("node:child_process").spawnSync("fd", ["--version"], { encoding: "utf8" });
      console.log(JSON.stringify({ cwd: process.cwd(), env: process.env, args: process.argv.slice(2), fd: fd.stdout, auth }));
      process.exit(process.argv.includes("--fail") ? 7 : 0);
    `);
    const bin = join(root, "bin");
    mkdirSync(bin);
    const link = join(bin, "pi-clean");
    symlinkSync("../pi-clean", link);

    const agentDir = join(root, "personal-agent");
    mkdirSync(join(agentDir, "bin"), { recursive: true });
    writeFileSync(join(agentDir, "bin/fd"), "#!/bin/sh\nprintf 'fixture-fd\\n'\n", { mode: 0o755 });

    writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ count: 10 }), { mode: 0o600 });
    const homes = new Set();
    for (const fail of [false, true]) {
      const args = ["-e", "/tmp/repro with spaces.ts", ...(fail ? ["--fail"] : [])];
      const result = spawnSync(link, args, {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          OPENAI_API_KEY: "must-not-leak",
          PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
          PI_CODING_AGENT_DIR: fail ? "personal-agent" : agentDir,
          PI_PACKAGE_DIR: "/patched/pi",
          PI_SESSION_ID: "personal-session",
          NODE_OPTIONS: "--invalid-option-must-not-reach-node",
        },
      });
      assert.equal(result.status, fail ? 7 : 0, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.equal(report.auth.count, fail ? 11 : 10, "shared auth must survive fresh invocations");
      assert.equal(JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf8")).count, fail ? 12 : 11);
      assert.notEqual(report.cwd, root);
      assert.equal(report.env.PWD, report.cwd);
      assert.equal(report.fd, "fixture-fd\n", "managed tools must remain discoverable without shell PATH setup");
      assert.equal(report.env.PI_OFFLINE, "1");
      assert.equal(report.env.PI_TELEMETRY, "0");
      for (const name of ["OPENAI_API_KEY", "PI_PACKAGE_DIR", "PI_SESSION_ID", "NODE_OPTIONS", "PI_CLEAN_AUTH_PATH"]) {
        assert.equal(report.env[name], undefined, name);
      }
      const runDir = dirname(report.env.HOME);
      for (const name of ["PI_CODING_AGENT_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "TMPDIR"]) {
        assert.equal(dirname(report.env[name]), runDir, name);
      }
      assert.equal(existsSync(runDir), false, "temporary environment survives exit");
      assert.deepEqual(report.args, [
        "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates",
        "--no-themes", "--no-context-files", ...args,
      ]);
      homes.add(report.env.HOME);
    }
    assert.equal(homes.size, 2, "runs must not share state");

    rmSync(cli);
    const missing = spawnSync(link, ["--version"], { encoding: "utf8" });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /npm ci --ignore-scripts/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
