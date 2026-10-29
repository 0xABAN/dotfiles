-- Rex speaks the kitty graphics protocol but answers XTVERSION as "rex", which
-- Snacks doesn't recognize, so Snacks images and plugin/background.lua stayed
-- off there. Register Rex before Snacks first detects (and caches) the terminal.

---@type LazySpec
return {
  "folke/snacks.nvim",
  opts = function()
    local envs = require("snacks.image.terminal").envs()

    -- lazy.nvim may resolve opts more than once; register Rex a single time.
    for _, env in ipairs(envs) do
      if env.name == "rex" then return end
    end

    table.insert(envs, {
      name = "rex",
      terminal = "rex",
      supported = true,
      -- Rex's rendering of Unicode placeholders is unverified; use the
      -- direct placements Snacks already uses for WezTerm.
      placeholders = false,
    })
  end,
}
