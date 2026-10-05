---@type LazySpec
return {
  {
    "AstroNvim/astrolsp",
    opts = {
      -- Not managed by Mason; uses Apple's clangd from Xcode, which knows the SDK header paths.
      servers = { "clangd" },
      config = {
        clangd = {
          -- Project compile commands take precedence over these fallback flags.
          init_options = { fallbackFlags = { "-std=c++20" } },
        },
        basedpyright = {
          settings = {
            basedpyright = {
              -- ruff owns import sorting
              disableOrganizeImports = true,
              analysis = { typeCheckingMode = "standard" },
            },
          },
        },
        ruff = {
          -- basedpyright's hovers are richer; avoid duplicate popups
          on_attach = function(client) client.server_capabilities.hoverProvider = false end,
        },
      },
    },
  },
  {
    -- Mason-installed servers are enabled automatically by AstroNvim.
    "WhoIsSethDaniel/mason-tool-installer.nvim",
    opts = { ensure_installed = { "basedpyright", "ruff", "vtsls" } },
  },
}
