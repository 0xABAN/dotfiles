---@type LazySpec
return {
  {
    "rebelot/heirline.nvim",
    opts = function(_, opts)
      -- Keep AstroNvim's buffer tabs, breadcrumbs, gutter, and their mappings.
      opts.statusline = nil
    end,
  },
  {
    "itchyny/lightline.vim",
    lazy = false,
    -- Lightline remembers the existing tabline even when its own is disabled.
    dependencies = { "rebelot/heirline.nvim" },
    config = function()
      vim.g.lightline = {
        colorscheme = "everforest",
        enable = { statusline = 1, tabline = 0 },
        separator = { left = "", right = "" },
        subseparator = { left = "", right = "" },
        active = {
          left = {
            { "mode", "paste" },
            { "readonly", "filename", "modified" },
            { "fileencoding", "fileformat", "filetype" },
          },
          right = { { "percent", "lineinfo" } },
        },
      }
      vim.fn["lightline#update"]()
    end,
  },
}
