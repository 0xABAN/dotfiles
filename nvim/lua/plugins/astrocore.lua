-- AstroCore: options, mappings, features
-- docs: :h astrocore

vim.api.nvim_create_user_command("SelFirstContent", function()
  vim.cmd "normal! gg"
  vim.fn.search("\\S", "cW")
  vim.cmd "normal! ^"
end, {})

vim.api.nvim_create_user_command("SelLastContent", function()
  vim.cmd "normal! G"
  vim.fn.search("\\S", "bcW")
  vim.cmd "normal! $"
end, {})

---@type LazySpec
return {
  "AstroNvim/astrocore",
  ---@type AstroCoreOpts
  opts = {
    features = {
      large_buf = { size = 1024 * 256, lines = 10000 },
      autopairs = true,
      cmp = true,
      diagnostics = { virtual_text = true, virtual_lines = false },
      highlighturl = true,
      notifications = true,
    },
    diagnostics = {
      virtual_text = true,
      underline = true,
    },
    options = {
      opt = {
        relativenumber = true,
        number = true,
        spell = false,
        signcolumn = "yes",
        wrap = false,
        clipboard = "unnamedplus", -- yank → macOS clipboard
        keymodel = "startsel,stopsel", -- shift+special starts/stops visual
        exrc = true, -- load a project's .nvim.lua; Neovim asks before trusting each file
      },
    },
    -- silent write when buffer changes (skips unnamed/special buffers)
    autocmds = {
      autosave = {
        {
          event = { "InsertLeave", "TextChanged", "FocusLost" },
          desc = "Autosave on leave/change/focus lost",
          callback = function(args)
            local bo = vim.bo[args.buf]
            if bo.modifiable and not bo.readonly and bo.buftype == "" and vim.api.nvim_buf_get_name(args.buf) ~= "" then
              vim.cmd("silent! update")
            end
          end,
        },
      },
    },
    mappings = {
      -- better-escape already maps jk → Esc; keep Mac word-delete
      i = {
        ["<M-BS>"] = { "<C-w>", desc = "Delete word backward" },
        ["<D-z>"] = { "<C-o>u", desc = "Undo" },
        ["<D-S-z>"] = { "<C-o><C-r>", desc = "Redo" },
        ["<C-a>"] = { "<C-o>^", desc = "First non-blank" },
        ["<C-e>"] = { "<End>", desc = "End of line" },
        ["<M-Left>"] = { "<C-Left>", desc = "Word left" },
        ["<M-Right>"] = { "<C-Right>", desc = "Word right" },
        ["<D-S-Left>"] = { "<C-o>v^", desc = "Select to first non-blank" },
        ["<D-S-Right>"] = { "<C-o>v$", desc = "Select to line end" },
        ["<D-S-Up>"] = { "<C-o>v<Cmd>SelFirstContent<CR>", desc = "Select to first content" },
        ["<D-S-Down>"] = { "<C-o>v<Cmd>SelLastContent<CR>", desc = "Select to last content" },
        ["<M-S-Left>"] = { "<C-o>vb", desc = "Select word left" },
        ["<M-S-Right>"] = { "<C-o>ve", desc = "Select word right" },
        ["<M-S-Up>"] = { "<C-o>v{", desc = "Select paragraph up" },
        ["<M-S-Down>"] = { "<C-o>v}", desc = "Select paragraph down" },
      },
      c = {
        ["<M-BS>"] = { "<C-w>", desc = "Delete word backward" },
        ["<M-Left>"] = { "<C-Left>", desc = "Word left" },
        ["<M-Right>"] = { "<C-Right>", desc = "Word right" },
      },
      n = {
        ["]b"] = { function() require("astrocore.buffer").nav(vim.v.count1) end, desc = "Next buffer" },
        ["[b"] = { function() require("astrocore.buffer").nav(-vim.v.count1) end, desc = "Previous buffer" },
        ["<D-z>"] = { "u", desc = "Undo" },
        ["<D-S-z>"] = { "<C-r>", desc = "Redo" },
        ["<M-Left>"] = { "b", desc = "Word left" },
        ["<M-Right>"] = { "w", desc = "Word right" },
        ["<D-S-Left>"] = { "v^", desc = "Select to first non-blank" },
        ["<D-S-Right>"] = { "v$", desc = "Select to line end" },
        ["<D-S-Up>"] = { "v<Cmd>SelFirstContent<CR>", desc = "Select to first content" },
        ["<D-S-Down>"] = { "v<Cmd>SelLastContent<CR>", desc = "Select to last content" },
        ["<M-S-Left>"] = { "vb", desc = "Select word left" },
        ["<M-S-Right>"] = { "ve", desc = "Select word right" },
        ["<M-S-Up>"] = { "v{", desc = "Select paragraph up" },
        ["<M-S-Down>"] = { "v}", desc = "Select paragraph down" },
      },
      x = {
        J = { ":m '>+1<CR>gv=gv", desc = "Move selected lines down" },
        K = { ":m '<-2<CR>gv=gv", desc = "Move selected lines up" },
      },
      v = {
        ["<M-Left>"] = { "<Esc>b", desc = "Word left" },
        ["<M-Right>"] = { "<Esc>w", desc = "Word right" },
        ["<BS>"] = { '"_c', desc = "Delete selection" },
        ["<Del>"] = { '"_c', desc = "Delete selection" },
        ["<D-S-Left>"] = { "^", desc = "Select to first non-blank" },
        ["<D-S-Right>"] = { "$", desc = "Select to line end" },
        ["<D-S-Up>"] = { "<Cmd>SelFirstContent<CR>", desc = "Select to first content" },
        ["<D-S-Down>"] = { "<Cmd>SelLastContent<CR>", desc = "Select to last content" },
        ["<M-S-Left>"] = { "b", desc = "Select word left" },
        ["<M-S-Right>"] = { "e", desc = "Select word right" },
        ["<M-S-Up>"] = { "{", desc = "Select paragraph up" },
        ["<M-S-Down>"] = { "}", desc = "Select paragraph down" },
      },
    },
  },
}
