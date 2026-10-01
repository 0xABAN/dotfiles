---@type LazySpec
return {
  "sainnhe/everforest",
  lazy = false,
  priority = 1000,
  config = function()
    -- Configure when the theme loads: AstroCore can select it before all init hooks run.
    -- Keep upstream Dark Hard's opaque backgrounds and highlights.
    vim.o.background = "dark"
    vim.g.everforest_background = "hard"
  end,
}
