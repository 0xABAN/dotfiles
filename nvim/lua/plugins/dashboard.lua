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
        header = require "dashboard-header",
      },
    },
  },
  -- snacks caches PDF previews by path, not mtime. :e reused a stale/missing convert.
  init = function()
    vim.env.PATH = "/opt/homebrew/bin:" .. (vim.env.PATH or "")
    vim.api.nvim_create_autocmd("User", {
      pattern = "VeryLazy",
      callback = function()
        local bufmod = require "snacks.image.buf"
        local attach = bufmod.attach
        bufmod.attach = function(buf, opts)
          local src = (opts and opts.src) or vim.api.nvim_buf_get_name(buf)
          if src:lower():find "%.pdf$" then
            local cache = vim.fn.stdpath "cache" .. "/snacks/image"
            local base = vim.fn.fnamemodify(src, ":t:r"):gsub("[^%w%.]+", "-")
            local pngs = vim.fn.glob(cache .. "/*-" .. base .. ".png", false, true)
            local pdf = vim.uv.fs_stat(src)
            local png = pngs[1] and vim.uv.fs_stat(pngs[1])
            if not png or (pdf and png.mtime.sec < pdf.mtime.sec) then
              require("snacks.image.image").clear()
              for _, f in ipairs(vim.fn.glob(cache .. "/*-" .. base .. ".*", false, true)) do
                vim.fn.delete(f)
              end
            end
          end
          return attach(buf, opts)
        end
      end,
    })
  end,
}
