---@type LazySpec
return {
  {
    "nvim-neo-tree/neo-tree.nvim",
    init = function()
      vim.api.nvim_create_autocmd("VimEnter", {
        group = vim.api.nvim_create_augroup("UserExplorerStartup", { clear = true }),
        once = true,
        callback = function()
          if #vim.api.nvim_list_uis() == 0 or vim.o.diff then return end
          vim.schedule(function() vim.cmd "Neotree focus filesystem left" end)
        end,
      })
    end,
    opts = {
      filesystem = {
        filtered_items = {
          hide_dotfiles = false,
          hide_gitignored = false,
          hide_by_name = { ".git", ".DS_Store" },
        },
      },
    },
  },
  {
    "folke/snacks.nvim",
    opts = {
      picker = {
        sources = {
          files = { hidden = true, ignored = true },
          grep = { hidden = true, ignored = true },
        },
      },
    },
  },
}
