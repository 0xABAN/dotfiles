-- Luau (Roblox). luau-lsp, StyLua and Selene come from each project's
-- rokit.toml, so the editor runs the versions that project's CI pins.
-- Projects tune luau-lsp.nvim in their own .nvim.lua (loaded via `exrc`).

---@type LazySpec
return {
  { "lopi-py/luau-lsp.nvim", opts = {} },
  {
    "nvimtools/none-ls.nvim",
    opts = function(_, opts)
      local null_ls = require "null-ls"
      opts.sources = require("astrocore").list_insert_unique(opts.sources, {
        -- Luau only: Rokit's shims fail outside a Rokit project, which would
        -- break formatting and linting for this config's own Lua files.
        null_ls.builtins.formatting.stylua.with { filetypes = { "luau" } },
        null_ls.builtins.diagnostics.selene.with { filetypes = { "luau" } },
      })
    end,
  },
}
