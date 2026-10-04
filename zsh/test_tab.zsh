#!/usr/bin/env zsh
# Run with: zsh -f zsh/test_tab.zsh (requires the documented shell dependencies).
source "${0:A:h}/.zshrc"
SAVEHIST=0

# The plugin must leave our dispatcher untouched when binding widgets.
_zsh_autosuggest_bind_widgets
[[ $widgets[_autosuggest-or-complete] == user:_autosuggest-or-complete ]] || exit 1
[[ $(bindkey '^I') == *'_autosuggest-or-complete' ]] || exit 1

# Capture dispatch without requiring an interactive line editor.
zle() { selected_widget=$1; }

BUFFER='cd conf'
CURSOR=${#BUFFER}
POSTDISPLAY='igs'
_autosuggest-or-complete
[[ $selected_widget == autosuggest-accept ]] || exit 1

POSTDISPLAY=''
_autosuggest-or-complete
[[ $selected_widget == expand-or-complete ]] || exit 1

POSTDISPLAY='igs'
CURSOR=3
_autosuggest-or-complete
[[ $selected_widget == expand-or-complete ]] || exit 1

print 'PASS: Tab accepts suggestions at end of line, otherwise completes'
