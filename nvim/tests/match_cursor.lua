-- Run: nvim --headless -u NONE -l nvim/tests/match_cursor.lua
vim.opt.runtimepath:prepend(vim.fn.getcwd() .. "/nvim")
vim.cmd.colorscheme("osaka-jade")
vim.cmd("runtime plugin/matchparen.vim")
vim.cmd("runtime plugin/match_cursor.lua")

-- Smear uses this cursor group after VeryLazy; the default cursor must survive.
vim.opt.guicursor:append("a:SmearCursorHideable")
vim.api.nvim_set_hl(0, "SmearCursorHideable", { blend = 0 })
local original = vim.o.guicursor
local override = "n:OsakaMatchCursor"
vim.api.nvim_buf_set_lines(0, 0, -1, false, { "{ x }", "( y )", "[ z ]", "界{}", "unmatched {" })

local function settle()
  vim.api.nvim_exec_autocmds("SafeState", {})
  local done = false
  vim.schedule(function() done = true end)
  assert(vim.wait(1000, function() return done end), "scheduled cursor update must run")
end

local function move(row, col)
  vim.api.nvim_win_set_cursor(0, { row, col })
  vim.api.nvim_exec_autocmds("CursorMoved", {})
  settle()
end

local function matched(row, col)
  move(row, col)
  local matches = vim.fn.getmatches()
  assert(#matches == 1 and matches[1].group == "MatchParen", "must use native bracket matching")
  assert(matches[1].pos1[1] == row and matches[1].pos1[2] == col + 1, "current bracket must be painted")
  assert(matches[1].pos2, "partner bracket must also be painted")
  assert(vim.o.guicursor == original .. "," .. override, "hardware cursor must not cover the matched bracket")
  assert(vim.api.nvim_get_hl(0, { name = "OsakaMatchCursor" }).blend == 100, "hide only the hardware overlay")

  -- Animation completion must not uncover the hardware cursor over the bracket.
  vim.api.nvim_set_hl(0, "SmearCursorHideable", { blend = 0 })
  settle()
  assert(vim.o.guicursor == original .. "," .. override, "animation must not replace the match cursor")
end

for row = 1, 3 do
  -- Enter the closing bracket from ordinary text, not from its partner.
  move(row, 2)
  matched(row, 4)
  move(row, 2)
  matched(row, 0)
  move(row, 2)
  assert(vim.o.guicursor == original, "ordinary text must restore the exact cursor settings")
end
matched(4, 3) -- Neovim cursor columns are byte offsets, including after Unicode.
matched(4, 4)
move(5, 10)
assert(#vim.fn.getmatches() == 0, "unmatched brackets must not be highlighted")
assert(vim.o.guicursor == original, "unmatched brackets must keep the normal cursor")

matched(1, 0)
vim.cmd("NoMatchParen")
settle()
assert(vim.o.guicursor == original, "disabling matching must restore the cursor")
vim.cmd("DoMatchParen")
matched(1, 4)

for _, event in ipairs({ "ModeChanged", "WinLeave", "BufLeave", "VimLeavePre" }) do
  vim.api.nvim_exec_autocmds(event, {})
  assert(vim.o.guicursor == original, event .. " must restore the normal cursor")
  matched(1, 0)
end

vim.cmd.colorscheme("woody")
settle()
assert(vim.o.guicursor == original, "other themes must retain their cursor")
vim.cmd.colorscheme("osaka-jade")
matched(1, 0)

-- Removing our override must not undo a later option change from another plugin.
vim.opt.guicursor:append("i:ver30")
move(1, 2)
assert(vim.o.guicursor == original .. ",i:ver30", "preserve external cursor changes")

-- A buffer can acquire its native match in a later SafeState callback, without
-- a CursorMoved event (for example, when first opening it on a bracket).
vim.cmd("new")
vim.api.nvim_buf_set_lines(0, 0, -1, false, { "{}" })
vim.api.nvim_exec_autocmds("BufWinEnter", {})
settle()
assert(vim.o.guicursor:find(override, 1, true), "new-buffer matches must hide the hardware overlay")

print("matched brackets expose both cells and restore the ordinary cursor: ok")
