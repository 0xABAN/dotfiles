# pi-dev

Run the Pi fork in `~/dev/pi` straight from its TypeScript source. Edits to the
fork take effect on the next start; no build is needed.

## Install

From this directory:

```sh
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/pi-dev" "$HOME/.local/bin/pi-dev"
```

The fork needs its dependencies and model data first:

```sh
cd ~/dev/pi
npm ci --ignore-scripts
npm run hydrate:model-data
```

## Configuration

`pi-dev` keeps its own config folder, `~/.pi-dev/agent`, so its sessions and
settings never touch your daily `pi` in `~/.pi/agent`.

On first run it creates:

- `settings.json`, copied from `settings.json` here. It loads the extensions
  from `~/dev/pi-extensions`, both your own collection and the maintained copies
  of powerline, todo, ask-user-question, intercom, the Claude bridge, ponytail
  and the skill palette, plus `pi-goal`. Like your daily `pi`, it sets the
  default model, the Everforest theme from `pi/agent/themes`, quiet startup,
  codemode and the powerline layout. Pi edits this copy as you change settings;
  delete it to start over.
- `models.json`, a link to your daily `models.json`, so custom providers such as
  Cerebras work.
- `keybindings.json`, a link to your daily `keybindings.json`, so `pi-dev` uses
  your daily shortcuts.
- `APPEND_SYSTEM.md`, a link to your daily `APPEND_SYSTEM.md`, so `pi-dev` gets
  the same git commit policy.

Your daily `pi`'s downloaded tools (`fd`, `rg`) are reused.

## Verify

```sh
bash -n pi-dev
pi-dev --version
```
