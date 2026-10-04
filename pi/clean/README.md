# pi-clean

Run official Pi **0.85.1** independently of the normal `pi` installation. The npm
lockfile pins its dependencies. The initial bug-report recordings used 0.84.2;
the paste/cut/submit/yank bug was also reproduced interactively on 0.85.1.

## Install

From this directory:

```sh
npm ci --ignore-scripts
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/pi-clean" "$HOME/.local/bin/pi-clean"
```

`~/.local/bin` must be on `PATH`. The link command intentionally refuses to
replace an existing command. Reinstall dependencies with `npm ci --ignore-scripts`;
do not use `pi-clean update` to change the pinned installation.

## Use

```sh
pi-clean
pi-clean --version
pi-clean --tui-mode fullscreen
pi-clean -e /absolute/path/to/repro.ts
```

Each invocation starts in an empty temporary working directory with a fresh home
and Pi configuration. Automatic extensions, skills, templates, themes, and context
files are disabled. Explicit reproduction extensions still work. Use **absolute
paths** for file arguments because the working directory changes.

Inherited API-key environment variables, Pi overrides, Node options, and host
integration variables are removed. Stored authentication is shared with normal Pi
as described below. Terminal capabilities, locale, and `PATH` are retained. The original
Pi agent's `bin` directory is prepended to `PATH` so downloaded tools such as `fd`
remain available without another download. Startup network operations and telemetry
are disabled. Model calls are not network-blocked and can use your shared login.

## Shared authentication

`pi-clean` uses normal Pi's `~/.pi/agent/auth.json`, or the caller's
`$PI_CODING_AGENT_DIR/auth.json` when that override is set. Existing OAuth logins
and stored API keys are available immediately. Login and token refresh persist
across invocations; **logout affects normal Pi too**. Environment-only API keys
are still stripped.

The pinned CLI has no separate auth-path option. `auth_store.mjs` is loaded before
CLI startup and redirects its default `AuthStorage.create` calls to the shared
file, using **the same lock path** as normal Pi. A temporary symlink supports
read-only auth helpers; writes do not lock through that alias. Explicit custom
auth stores created by reproduction extensions remain independent. The installed
release files are not modified. Recheck this adapter when changing the pinned
version.

Sessions are not saved. Temporary files and settings are discarded on exit;
shared authentication is retained. A forced kill or machine crash can leave a
`/tmp/pi-clean.*` directory behind. Export anything you want to keep to an explicit
path outside that temporary directory before quitting.

This is **configuration isolation, not a security sandbox**. Pi's tools and any
explicit extension still run as your user and can access the filesystem. This
launcher does not isolate your operating system, Node installation, or terminal.
Your usual `pi` command, patches, and personal settings remain untouched. The
shared auth file is the deliberate exception to configuration isolation.

## Verify

```sh
bash -n pi-clean
pi-clean --version
```
