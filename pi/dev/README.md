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

- `settings.json`, copied from `settings.json` here. It loads only the Claude
  bridge, using the copy your daily `pi` installed, sets the default model, and
  uses the Everforest theme from `pi/agent/themes`, like your daily `pi`.
  Pi edits this copy as you change settings; delete it to start over.
- `models.json`, a link to your daily `models.json`, so custom providers such as
  Cerebras work.

Your daily `pi`'s downloaded tools (`fd`, `rg`) are reused, and the check for new
Pi releases is off.

## Verify

```sh
bash -n pi-dev
pi-dev --version
```
