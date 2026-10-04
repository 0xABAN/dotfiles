-- Run: nvim --headless -u NONE -l nvim/tests/explorer_startup.lua
local spec = dofile("nvim/lua/plugins/neo_tree.lua")[1]
local opens = 0
vim.api.nvim_create_user_command("Neotree", function(args)
  assert(args.args == "focus filesystem left", "startup must focus the explorer")
  opens = opens + 1
end, { nargs = "*" })

local list_uis = vim.api.nvim_list_uis
local function startup(ui, diff)
  vim.api.nvim_list_uis = function() return ui and { {} } or {} end
  vim.o.diff = diff
  spec.init()
  vim.api.nvim_exec_autocmds("VimEnter", {})
  vim.wait(20, function() return false end)
end

startup(false, false)
assert(opens == 0, "headless startup must not open the explorer")
startup(true, true)
assert(opens == 0, "diff startup must not open the explorer")
startup(true, false)
assert(opens == 1, "interactive startup must open the explorer")
vim.api.nvim_exec_autocmds("VimEnter", {})
vim.wait(20, function() return false end)
assert(opens == 1, "startup must only run once")
vim.api.nvim_list_uis = list_uis
print("explorer startup checks passed")
