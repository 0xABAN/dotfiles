---@type LazySpec
return {
  "rose-pine/neovim",
  name = "rose-pine",
  lazy = false,
  priority = 1000,
  opts = {
    variant = "main",
    -- Keep the terminal's glass background instead of adding an opaque layer.
    styles = { transparency = true },
  },
}
