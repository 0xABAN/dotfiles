-- Isolated: nvim --headless -u NONE -l nvim/tests/everforest.lua
-- Configured startup: nvim --headless -u nvim/init.lua -l nvim/tests/everforest.lua
local root = vim.fn.getcwd()
local plugins = vim.fn.stdpath("data") .. "/lazy/"
local plugin = vim.env.EVERFOREST_ROOT or (plugins .. "everforest")
local rose = vim.env.ROSE_PINE_ROOT or (plugins .. "rose-pine")
assert(vim.fn.isdirectory(plugin) == 1, "Install sainnhe/everforest with Lazy first")
vim.opt.runtimepath:prepend(root .. "/nvim")
vim.opt.runtimepath:prepend(plugin)
vim.opt.runtimepath:prepend(rose)

local spec = dofile(root .. "/nvim/lua/plugins/everforest.lua")
assert(spec[1] == "sainnhe/everforest")
-- Do not reapply the theme when testing startup: that would hide load-order bugs.
if not vim.g.colors_name then
  spec.config()
  vim.cmd.colorscheme("everforest")
end

local function check()
  assert(vim.g.colors_name == "everforest")
  assert(vim.o.background == "dark")
  local config = vim.fn["everforest#get_configuration"]()
  assert(config.background == "hard")
  assert(config.transparent_background == 0, "use the upstream opaque background")
  assert(vim.tbl_isempty(config.colors_override), "do not customize the upstream palette")
  local normal = vim.api.nvim_get_hl(0, { name = "Normal", link = false })
  assert(normal.bg == 0x272e33, "must use Dark Hard, not Dark Medium")
  assert(normal.fg == 0xd3c6aa)
  assert(vim.api.nvim_get_hl(0, { name = "DiagnosticError", link = false }).fg == 0xe67e80)
end

check()
require("rose-pine").setup(dofile(root .. "/nvim/lua/plugins/rose-pine.lua").opts)
vim.cmd.colorscheme("rose-pine")
assert(vim.api.nvim_get_hl(0, { name = "Normal", link = false }).fg == 0xe0def4)
vim.cmd.colorscheme("everforest")
check()
print("upstream Everforest Dark Hard and saved Rosé Pine switching: ok")
