-- Run: nvim --headless -u nvim/init.lua -l nvim/tests/lightline.lua
assert(vim.g.loaded_lightline == 1, "Lightline must load at startup")
local heirline = require "heirline"
assert(heirline.statusline == nil, "only Lightline should own the footer")
assert(heirline.tabline and heirline.winbar and heirline.statuscolumn)
assert(vim.g.lightline.enable.tabline == 0)
assert(vim.o.laststatus == 3, "keep the existing global footer")

vim.cmd.enew()
vim.api.nvim_buf_set_name(0, "lightline-check.txt")
vim.api.nvim_buf_set_lines(0, 0, -1, false, { "first line", "second line" })
vim.bo.filetype = "text"

local function check()
  assert(vim.wo.statusline:find("lightline", 1, true), "Lightline must survive buffer/window changes")
  assert(vim.o.tabline:find("heirline", 1, true), "keep the buffer tabs")
  assert(vim.wo.winbar:find("heirline", 1, true), "keep breadcrumbs")
  assert(vim.wo.statuscolumn:find("heirline", 1, true), "keep the gutter")
  local rendered = vim.api.nvim_eval_statusline(vim.wo.statusline, { maxwidth = 160 }).str
  for _, text in ipairs { "lightline-check.txt", "utf-8", "unix", "text", "", "" } do
    assert(rendered:find(text, 1, true), "missing footer component: " .. text)
  end
  local mode = vim.api.nvim_get_hl(0, { name = "LightlineLeft_normal_0", link = false })
  assert(mode.bg == 0xa7c080 and mode.fg == 0x272e33, "use the upstream Everforest Hard palette")
end

check()
vim.cmd.vsplit()
check()
vim.cmd.wincmd("p")
check()

-- Reinitializing Lightline must not restore an empty pre-Heirline tabline.
vim.fn["lightline#init"]()
vim.fn["lightline#update"]()
vim.cmd.colorscheme("everforest")
check()
for _, key in ipairs { "bb", "bd", "b\\", "b|" } do
  assert(vim.fn.maparg("<Leader>" .. key, "n") ~= "", "keep buffer-picker mapping: " .. key)
end
assert(vim.v.errmsg == "", vim.v.errmsg)
print("Lightline footer, Everforest palette, and preserved Heirline navigation: ok")
