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

- `settings.json`, copied from `settings.json` here. It loads the Claude bridge
  from the copy your daily `pi` installed, plus the third-party extensions the
  patchers leave alone: `pi-goal`, `ponytail` and `pi-skill-palette`.
  It also sets the default model and uses the Everforest theme from
  `pi/agent/themes`, like your daily `pi`. Pi edits this copy as you change
  settings; delete it to start over.
- `models.json`, a link to your daily `models.json`, so custom providers such as
  Cerebras work.
- `keybindings.json`, a link to your daily `keybindings.json`, so `pi-dev` uses
  your daily shortcuts.

Your daily `pi`'s downloaded tools (`fd`, `rg`) are reused.

## Verify

```sh
bash -n pi-dev
pi-dev --version
```
