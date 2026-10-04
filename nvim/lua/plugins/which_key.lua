---@type LazySpec
return {
  "folke/which-key.nvim",
  opts = {
    -- default only defers V / block-visual; char visual popped the cheatsheet
    defer = function(ctx) return ctx.mode == "v" or ctx.mode == "V" or ctx.mode == "<C-V>" end,
  },
}
