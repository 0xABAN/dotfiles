import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Use the pinned backend, but only synthetic tokens in a disposable directory.
// Checking the lock inside modify() catches the unsafe symlink-only approach.
test("shares OAuth writes and logout across processes using the normal auth lock", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-clean-auth-test-"));
  try {
    const shared = join(root, "auth.json");
    writeFileSync(shared, JSON.stringify({
      fixture: { type: "oauth", access: "fake-access", refresh: "fake-refresh", expires: 0 },
      untouched: { type: "api_key", key: "fake-key" },
    }), { mode: 0o600 });
    const probe = join(root, "probe.mjs");
    const authModule = new URL("./node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js", import.meta.url);
    writeFileSync(probe, `
      import assert from "node:assert/strict";
      import { existsSync } from "node:fs";
      import { join } from "node:path";
      import { AuthStorage, ReadOnlyAuthStorage, readStoredCredential } from ${JSON.stringify(authModule.href)};
      const shared = ${JSON.stringify(shared)};
      const temporary = join(process.env.PI_CODING_AGENT_DIR, "auth.json");
      const iteration = Number(process.argv[2]);
      const store = iteration === 0 ? AuthStorage.create() : AuthStorage.create(temporary);
      assert.equal((await store.read("fixture")).expires, iteration);
      await store.modify("fixture", current => {
        assert(existsSync(shared + ".lock"), "must lock the same path as normal Pi");
        assert(!existsSync(temporary + ".lock"), "must not lock the temporary alias");
        return { ...current, expires: current.expires + 1 };
      });
      assert.equal((await new ReadOnlyAuthStorage().read("fixture")).expires, iteration + 1);
      assert.equal(readStoredCredential("fixture").expires, iteration + 1);
      const custom = join(process.env.PI_CODING_AGENT_DIR, "custom-auth.json");
      AuthStorage.create(custom);
      assert(existsSync(custom), "explicit custom stores must stay independent");
      if (iteration === 2) await store.delete("fixture");
    `);
    for (let iteration = 0; iteration < 3; iteration++) {
      const agent = join(root, `agent-${iteration}`);
      mkdirSync(agent);
      const result = spawnSync(process.execPath, [
        "--import", fileURLToPath(new URL("./auth_store.mjs", import.meta.url)), probe, String(iteration),
      ], {
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: agent, PI_CLEAN_AUTH_PATH: shared },
      });
      assert.equal(result.status, 0, result.stderr);
      const saved = JSON.parse(readFileSync(shared, "utf8"));
      assert.equal(saved.fixture?.expires, iteration === 2 ? undefined : iteration + 1);
      assert.deepEqual(saved.untouched, { type: "api_key", key: "fake-key" });
      assert.equal(statSync(shared).mode & 0o777, 0o600);
      rmSync(agent, { recursive: true });
      assert(existsSync(shared), "run cleanup must not remove shared credentials");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the official CLI sees stored authentication with default HOME resolution", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-clean-cli-auth-test-"));
  try {
    const agent = join(root, ".pi/agent");
    mkdirSync(agent, { recursive: true, mode: 0o700 });
    const auth = JSON.stringify({ anthropic: { type: "api_key", key: "fake-no-network-key" } });
    writeFileSync(join(agent, "auth.json"), auth, { mode: 0o600 });
    for (let invocation = 0; invocation < 2; invocation++) {
      // Listing catalogs with PI_OFFLINE (set by the launcher) makes no model call.
      const result = spawnSync(fileURLToPath(new URL("./pi-clean", import.meta.url)), ["--list-models"], {
        encoding: "utf8",
        env: { PATH: process.env.PATH, HOME: root },
        timeout: 15000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /anthropic/);
      assert.equal(readFileSync(join(agent, "auth.json"), "utf8"), auth);
      assert(!existsSync(join(agent, "settings.json")), "normal settings must not be created");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
