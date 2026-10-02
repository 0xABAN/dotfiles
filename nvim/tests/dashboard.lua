-- Run: nvim --headless -u nvim/init.lua -l nvim/tests/dashboard.lua
local dashboard = Snacks.dashboard.open({ win = 0 })
assert(dashboard.items[1].header == dashboard.opts.preset.header)
local header = vim.split(dashboard.opts.preset.header, "\n", { plain = true })
assert(#header == 11, "use the upstream hydra instead of the ADAM banner")
for _, line in ipairs(header) do
  assert(vim.fn.strdisplaywidth(line) == 35, "preserve the hydra's alignment padding")
end

assert(#dashboard.items == 7 and #dashboard.opts.preset.keys == 6, "retain title and six shortcuts")
assert(#dashboard.opts.sections == 2, "do not restore startup statistics")
for _, item in ipairs(dashboard.opts.preset.keys) do
  assert(vim.fn.maparg(item.key, "n") ~= "", "missing shortcut: " .. item.key)
end

local function check_colors()
  local function foreground(group)
    return vim.api.nvim_get_hl(0, { name = group, link = false }).fg
  end
  for _, group in ipairs { "SnacksDashboardDesc", "SnacksDashboardIcon", "SnacksDashboardKey" } do
    assert(foreground(group) == foreground("Normal"), group .. " must use the normal text color")
  end
  assert(foreground("Special") ~= foreground("Normal"), "do not recolor shared syntax groups")
  assert(foreground("Number") ~= foreground("Normal"), "do not recolor shared syntax groups")
  assert(foreground("SnacksDashboardHeader") == foreground("Title"), "leave the title unchanged")
end

check_colors()
vim.cmd.colorscheme("everforest")
check_colors() -- AstroUI must reapply the links after a theme reload.

vim.cmd.enew()
assert(vim.v.errmsg == "", vim.v.errmsg)
print("dashboard hydra, text-colored shortcuts, mappings, and theme reload: ok")
