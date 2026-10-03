alias dev="cd ~/Projects"
alias code="zed"

alias cc="claude"
alias ccr="claude --resume"

alias p="pi"
alias oc="opencode"

alias gaa="git add --all"
alias gcl="git clone"
alias gs="git status"
alias gcm="git commit -m"
alias gps="git push"
alias gpl="git pull"

export EDITOR="zed --wait"

export PATH="$HOME/.local/bin:$PATH"
export PATH="/Library/Frameworks/Python.framework/Versions/3.12/bin:$PATH"
alias python=python3

PROMPT='%n @ mac %1~ %% '

# Google Cloud SDK
if [ -f "$HOME/.local/google-cloud-sdk/path.zsh.inc" ]; then
  . "$HOME/.local/google-cloud-sdk/path.zsh.inc"
fi
if [ -f "$HOME/.local/google-cloud-sdk/completion.zsh.inc" ]; then
  . "$HOME/.local/google-cloud-sdk/completion.zsh.inc"
fi

# Daytona completion (if installed)
if [ -f "$HOME/.daytona.completion_script.zsh" ]; then
  source "$HOME/.daytona.completion_script.zsh"
fi

gotd-smoke() {
  local release_date="${1:-2099-07-22}"
  local data_dir="${2:-/tmp/gotd-daytona-smoke}"
  (
    cd "$HOME/dev/vibe-check" || return
    uv run --project src/backend python -m src.backend.cli \
      --runtime daytona --artifact-only --real-smoke \
      --date "$release_date" --data-dir "$data_dir"
  )
}

# Launch two tModLoader clients (local multiplayer testing).
tml() {
  local tml_sh="$HOME/Library/Application Support/Steam/steamapps/common/tModLoader/start-tModLoader.sh"
  "$tml_sh" "$@" >/dev/null 2>&1 &
  "$tml_sh" "$@" >/dev/null 2>&1 &
  disown
}

# Kill all tModLoader clients started via tml / Steam.
tmlkill() {
  pkill -f 'tModLoader\.dll' 2>/dev/null
  pkill -f 'start-tModLoader\.sh' 2>/dev/null
}

# .NET SDK (tModLoader + CLI)
export DOTNET_ROOT="$HOME/.dotnet"
export PATH="$DOTNET_ROOT:$PATH"

# Keep history across sessions for inline command suggestions.
HISTFILE=~/.zsh_history
HISTSIZE=10000
SAVEHIST=10000
setopt APPEND_HISTORY

# fzf
alias ff="fzf"
source <(fzf --zsh)

# Smart directory jumps and history-based inline suggestions.
eval "$(zoxide init zsh --cmd cd)"
source "${HOMEBREW_PREFIX:-/opt/homebrew}/share/zsh-autosuggestions/zsh-autosuggestions.zsh"

# The leading underscore keeps autosuggestions from wrapping this widget and
# clearing POSTDISPLAY before we can check whether a suggestion is visible.
_autosuggest-or-complete() {
  if [[ -n $POSTDISPLAY ]] && (( CURSOR == ${#BUFFER} )); then
    zle autosuggest-accept
  else
    zle expand-or-complete
  fi
}
zle -N _autosuggest-or-complete
bindkey '^I' _autosuggest-or-complete

# machine-local secrets / overrides (not tracked)
[[ -f ~/.zshrc.local ]] && source ~/.zshrc.local
# The following lines have been added by Docker Desktop to enable Docker CLI completions.
fpath=(/Users/adam/.docker/completions $fpath)
autoload -Uz compinit
(( ${+_comps[docker]} )) || compinit
# End of Docker CLI completions

export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] &&
  source "/opt/homebrew/opt/nvm/nvm.sh"
