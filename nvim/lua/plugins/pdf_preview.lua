-- snacks caches PDF previews by path, not mtime. :e reused a stale/missing convert.

---@type LazySpec
return {
  "folke/snacks.nvim",
  init = function()
    vim.api.nvim_create_autocmd("User", {
      pattern = "VeryLazy",
      callback = function()
        local convert = require "snacks.image.convert"
        local bufmod = require "snacks.image.buf"
        local attach = bufmod.attach

        bufmod.attach = function(buf, opts)
          local src = (opts and opts.src) or vim.api.nvim_buf_get_name(buf)

          if src:lower():find "%.pdf$" then
            -- Same cache name Snacks builds in snacks/image/convert.lua.
            local path, page = convert.get_page(src)
            path = convert.norm(path)
            local base = vim.fn.fnamemodify(path, ":t:r"):gsub("[^%w%.]+", "-")
            local prefix = Snacks.image.config.cache .. "/" .. vim.fn.sha256(path .. page):sub(1, 8) .. "-" .. base

            local pdf = vim.uv.fs_stat(path)
            local png = vim.uv.fs_stat(prefix .. ".png")

            if not png or (pdf and png.mtime.sec < pdf.mtime.sec) then
              require("snacks.image.image").clear()
              for _, f in ipairs(vim.fn.glob(prefix .. ".*", false, true)) do
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
