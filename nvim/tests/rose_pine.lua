-- Run: nvim --headless -u NONE -l nvim/tests/rose_pine.lua
local root = vim.fn.getcwd()
local plugin = vim.env.ROSE_PINE_ROOT or (vim.fn.stdpath("data") .. "/lazy/rose-pine")
assert(vim.fn.isdirectory(plugin) == 1, "Install rose-pine/neovim with Lazy first")
vim.opt.runtimepath:prepend(root .. "/nvim")
vim.opt.runtimepath:prepend(plugin)

local spec = dofile(root .. "/nvim/lua/plugins/rose_pine.lua")
assert(spec[1] == "rose-pine/neovim")
require("rose-pine").setup(spec.opts)
vim.o.background = "dark"
vim.cmd.colorscheme("rose-pine")

local function check()
  assert(vim.g.colors_name == "rose-pine")
  assert(require("rose-pine.palette").base == "#191724", "must use the Main variant")
  for _, group in ipairs({ "Normal", "NormalNC", "SignColumn", "StatusLine", "StatusLineNC" }) do
    local hl = vim.api.nvim_get_hl(0, { name = group, link = false })
    assert(hl.bg == nil, group .. " must inherit the terminal background")
  end
  assert(vim.api.nvim_get_hl(0, { name = "Normal", link = false }).fg == 0xe0def4)
  assert(vim.api.nvim_get_hl(0, { name = "DiagnosticError", link = false }).fg == 0xeb6f92)
  assert(vim.api.nvim_get_hl(0, { name = "DiagnosticWarn", link = false }).fg == 0xf6c177)
end

check()
local smear = dofile(root .. "/nvim/lua/plugins/smear_cursor.lua")
assert(smear.opts.cursor_color == nil, "smear cursor must follow the active colorscheme")
vim.cmd.colorscheme("osaka-jade")
assert(vim.api.nvim_get_hl(0, { name = "Normal", link = false }).fg == 0xd8dad8)
vim.cmd.colorscheme("rose-pine")
check()
print("rose-pine main, transparent backgrounds and Osaka Jade switching: ok")
