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

autoload -Uz compinit && compinit

eval "$(zoxide init zsh --cmd cd)"
source "${HOMEBREW_PREFIX:-/opt/homebrew}/share/zsh-autosuggestions/zsh-autosuggestions.zsh"

_autosuggest-or-complete() {
  if [[ -n $POSTDISPLAY ]] && (( CURSOR == ${#BUFFER} )); then
    zle autosuggest-accept
  else
    zle expand-or-complete
  fi
}
zle -N _autosuggest-or-complete
bindkey '^I' _autosuggest-or-complete

export PATH="/Applications/Rex Beta.app/Contents/Helpers/Rex Server.rex/Contents/MacOS:$PATH"
