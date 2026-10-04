import { test } from "bun:test";
import { join } from "node:path";
import { checkProcess, temporaryDirectory } from "./patch_fixtures";

/** Native Pi imports need a fresh process: Bun module mocks leak between files. */
export function nativeSuite(file: string, enabled: boolean, env: Record<string, string> = {}) {
  const child = process.env.CONFIGS_NATIVE_TEST_FILE === file;
  const register = (name: string, run: () => unknown) => { test(name, run); };
  const omit = (_name: string, _run: () => unknown) => {};

  if (enabled && !child) {
    const agent = temporaryDirectory("pi-native-agent-");
    test("native integration passes in an isolated process", () => {
      const result = Bun.spawnSync([process.execPath, "test", file], {
        env: {
          ...process.env, ...env,
          CONFIGS_NATIVE_TEST_FILE: file,
          PI_CODING_AGENT_DIR: join(agent, "agent"),
        },
        timeout: 60_000,
      });
      checkProcess(result);
      // A successful child must have actually registered native cases.
      if (!/[1-9]\d* pass/.test(result.stderr.toString())) {
        throw new Error("No native tests ran:\n" + result.stderr.toString());
      }
    });
  }

  return {
    child,
    unitTest: child ? omit : register,
    nativeTest: !enabled ? (name: string, run: () => unknown) => test.skip(name + " (configure PI_SDK_ROOT and package source)", run)
      : child ? register : omit,
  };
}
