-- Ported from ~/.config/ghostty/config.
-- Rex leaves cmd+z, cmd+shift+z, and alt+shift+arrows unbound already, so
-- unbinding them here would only produce "nothing is bound" warnings.

-- Let Neovim own Mac line/file selection
rex.unbind("cmd+shift+left")
rex.unbind("cmd+shift+right")
rex.unbind("cmd+shift+up")
rex.unbind("cmd+shift+down")

-- Ctrl-Left/Right CSI (\x1b[1;5D, \x1b[1;5C) — stays in insert.
-- Rex's default sends alt+b/alt+f, which start with a real Escape.
rex.bind("alt+left", "pane.send_key", { key = "ctrl+left" })
rex.bind("alt+right", "pane.send_key", { key = "ctrl+right" })
