-- Ported from ~/.config/ghostty/config.

-- Let Neovim own undo/redo and Mac line/file selection
rex.unbind("cmd+z")
rex.unbind("cmd+shift+z")
rex.unbind("cmd+shift+left")
rex.unbind("cmd+shift+right")
rex.unbind("cmd+shift+up")
rex.unbind("cmd+shift+down")

-- Ctrl-Left/Right CSI (\x1b[1;5D, \x1b[1;5C) — stays in insert.
-- The terminal's default Alt-arrow is a real Escape.
rex.bind("alt+left", "pane.send_key", { key = "ctrl+left" })
rex.bind("alt+right", "pane.send_key", { key = "ctrl+right" })

rex.unbind("alt+shift+left")
rex.unbind("alt+shift+right")
rex.unbind("alt+shift+up")
rex.unbind("alt+shift+down")
