-- The terminal cursor covers MatchParen and ignores its foreground color.
-- Hide that overlay only on a matched bracket: the native match already paints
-- both cells, including white text. Leave matching/searching to matchparen.vim.
local cursor_part = "n:OsakaMatchCursor"
local group = vim.api.nvim_create_augroup("OsakaMatchCursor", { clear = true })

local function restore_cursor()
  if vim.o.guicursor:find(cursor_part, 1, true) then
    vim.opt.guicursor:remove(cursor_part)
  end
end

local function update_cursor()
  if vim.g.colors_name == "osaka-jade" and vim.api.nvim_get_mode().mode == "n" then
    local cursor = vim.api.nvim_win_get_cursor(0)
    for _, match in ipairs(vim.fn.getmatches()) do
      -- Native matchparen puts the current bracket first, in byte columns.
      local position = match.pos1
      if match.group == "MatchParen" and position
        and position[1] == cursor[1] and position[2] == cursor[2] + 1 then
        -- Neovim drops blend on an otherwise empty highlight definition.
        vim.api.nvim_set_hl(0, "OsakaMatchCursor", { fg = "white", blend = 100 })
        if not vim.o.guicursor:find(cursor_part, 1, true) then
          vim.opt.guicursor:append(cursor_part)
        end
        return
      end
    end
  end

  restore_cursor()
end

-- Native matchparen can update in another SafeState callback on buffer entry.
-- Run after those callbacks; a separate cursor group also survives smear-cursor
-- restoring its ordinary cursor when an animation finishes.
vim.api.nvim_create_autocmd("SafeState", {
  group = group,
  callback = function() vim.schedule(update_cursor) end,
})
vim.api.nvim_create_autocmd({ "ModeChanged", "WinLeave", "BufLeave", "ColorSchemePre", "VimLeavePre" }, {
  group = group,
  callback = restore_cursor,
})
