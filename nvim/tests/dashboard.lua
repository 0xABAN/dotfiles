-- Run: nvim --headless -u nvim/init.lua -l nvim/tests/dashboard.lua
local dashboard = Snacks.dashboard.open({ win = 0 })
assert(dashboard.items[1].header == dashboard.opts.preset.header)
assert(#dashboard.items == 7 and #dashboard.opts.preset.keys == 6, "retain title and six shortcuts")
assert(#dashboard.opts.sections == 2, "do not restore startup statistics")
for _, item in ipairs(dashboard.opts.preset.keys) do
  assert(vim.fn.maparg(item.key, "n") ~= "", "missing shortcut: " .. item.key)
end
vim.cmd.enew()
assert(vim.v.errmsg == "", vim.v.errmsg)
print("dashboard title, six shortcuts, and hidden startup statistics: ok")
