import { symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { AuthStorage } from "./node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";

const sharedAuthPath = process.env.PI_CLEAN_AUTH_PATH;
if (!sharedAuthPath || !process.env.PI_CODING_AGENT_DIR) {
  throw new Error("The auth adapter must be started through pi-clean.");
}
delete process.env.PI_CLEAN_AUTH_PATH;

const temporaryAuthPath = join(process.env.PI_CODING_AGENT_DIR, "auth.json");
const createAuthStorage = AuthStorage.create.bind(AuthStorage);

// The pinned CLI has no auth-path option. Redirect its default store before
// CLI startup, preserving explicit custom stores used by reproduction extensions.
// A symlink alone is unsafe: Pi locks with realpath:false, so refreshes would
// otherwise use a different lock from normal Pi and could overwrite each other.
AuthStorage.create = (authPath = temporaryAuthPath) =>
  createAuthStorage(resolve(authPath) === temporaryAuthPath ? sharedAuthPath : authPath);

// Read-only credential helpers bypass AuthStorage.create. They can follow a
// symlink safely; all normal credential mutations use the shared path above.
symlinkSync(sharedAuthPath, temporaryAuthPath);
