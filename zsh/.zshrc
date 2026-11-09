alias dev="cd ~/Projects"

alias p="pi"

alias gaa="git add --all"
alias gcl="git clone"
alias gs="git status"
alias gcm="git commit -m"
alias gps="git push"
alias gpl="git pull"

alias python=python3

PROMPT='%n @ mac %1~ %% '

# Initialize completion once, before any tool registers its completions.
autoload -Uz compinit && compinit

# .NET SDK (tModLoader + CLI)
export DOTNET_ROOT="$HOME/.dotnet"
export PATH="$DOTNET_ROOT:$PATH"

# Keep history across sessions for inline command suggestions.
HISTFILE=~/.zsh_history
HISTSIZE=10000
SAVEHIST=10000
setopt APPEND_HISTORY

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

# Load nvm without activating a version: activation costs ~200ms per shell.
# `node` is Homebrew's until `nvm use` runs in a project.
export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] &&
  source "/opt/homebrew/opt/nvm/nvm.sh" --no-use

# Rex CLI, bundled inside the app
export PATH="/Applications/Rex Beta.app/Contents/Helpers/Rex Server.rex/Contents/MacOS:$PATH"
