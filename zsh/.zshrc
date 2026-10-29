alias dev="cd ~/Projects"

alias p="pi"

# Hide pi's "Update Available" banner; `pi update` still works on demand.
export PI_SKIP_VERSION_CHECK=1

alias gaa="git add --all"
alias gcl="git clone"
alias gs="git status"
alias gcm="git commit -m"
alias gps="git push"
alias gpl="git pull"

export PATH="$HOME/.local/bin:$PATH"
export PATH="/Library/Frameworks/Python.framework/Versions/3.12/bin:$PATH"
alias python=python3

PROMPT='%n @ mac %1~ %% '

# Initialize completion once, before any tool registers its completions.
autoload -Uz compinit && compinit

# Google Cloud SDK
if [ -f "$HOME/.local/google-cloud-sdk/path.zsh.inc" ]; then
  . "$HOME/.local/google-cloud-sdk/path.zsh.inc"
fi
if [ -f "$HOME/.local/google-cloud-sdk/completion.zsh.inc" ]; then
  . "$HOME/.local/google-cloud-sdk/completion.zsh.inc"
fi

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

export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] &&
  source "/opt/homebrew/opt/nvm/nvm.sh"

# Rex CLI, bundled inside the app
export PATH="/Applications/Rex Beta.app/Contents/Helpers/Rex Server.rex/Contents/MacOS:$PATH"

# Machine-local secrets / overrides (not tracked). Keep this last so the
# overrides win over everything above.
[[ -f ~/.zshrc.local ]] && source ~/.zshrc.local
