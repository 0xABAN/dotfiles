-- Reuse the startup.nvim hydra artwork in the existing Snacks dashboard.

---@type LazySpec
return {
  "folke/snacks.nvim",
  opts = {
    words = { enabled = false },
    dashboard = {
      sections = {
        { section = "header", padding = 5 },
        { section = "keys", gap = 1, padding = 3 },
      },
      preset = {
        header = require "dashboard_header",
      },
    },
  },
}
