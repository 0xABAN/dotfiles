-- Pi "woody" syntax palette → nvim highlights.
-- Source: pi/agent/themes/woody.json (+ powerline ash/cream diffs)

vim.cmd("highlight clear")
if vim.fn.exists("syntax_on") == 1 then
  vim.cmd("syntax reset")
end

vim.g.colors_name = "woody"
vim.o.termguicolors = true
vim.o.background = "dark"

local c = {
  cream = "#ffffff",
  gray = "#a8a8a8",
  dim = "#6e6e6e",
  dark = "#4a4a4a",
  red = "#a22c29",
  redLight = "#c45a56",
  text = "#e8e0dc",
  paleOak = "#DCC9B6",
  ash = "#ABC4AB",
  cyan = "#AFE1EB", -- build-mode gradient mid
  creamPeach = "#ffd8c4",
  -- very dark brown blocks (pi selectedBg / userMsgBg)
  select = "#14110e",
  block = "#0e0c0a",
}

local function hi(group, opts)
  vim.api.nvim_set_hl(0, group, opts)
end

-- UI (bg NONE so Ghostty opacity shows through)
hi("Normal", { fg = c.text, bg = "NONE" })
hi("NormalNC", { fg = c.text, bg = "NONE" })
hi("NormalFloat", { fg = c.text, bg = "NONE" })
hi("FloatBorder", { fg = c.dim, bg = "NONE" })
hi("EndOfBuffer", { fg = c.dark, bg = "NONE" })
hi("LineNr", { fg = c.dark, bg = "NONE" })
hi("CursorLineNr", { fg = c.paleOak, bg = "NONE", bold = true })
hi("SignColumn", { bg = "NONE" })
hi("VertSplit", { fg = c.dark, bg = "NONE" })
hi("WinSeparator", { fg = c.dark, bg = "NONE" })
hi("StatusLine", { fg = c.text, bg = "NONE" })
hi("StatusLineNC", { fg = c.dim, bg = "NONE" })
hi("Pmenu", { fg = c.text, bg = c.select })
hi("PmenuSel", { fg = c.cream, bg = c.dark })
hi("Visual", { fg = c.block, bg = c.cream })
hi("Search", { fg = c.cream, bg = c.red })
hi("IncSearch", { fg = c.cream, bg = c.redLight })
hi("MatchParen", { fg = c.cream, bold = true })
hi("NonText", { fg = c.dark })
hi("Whitespace", { fg = c.dark })
hi("Directory", { fg = c.ash })
hi("Title", { fg = c.cream, bold = true })
hi("ErrorMsg", { fg = c.redLight })
hi("WarningMsg", { fg = c.paleOak })
hi("Question", { fg = c.gray })
hi("ModeMsg", { fg = c.gray })
hi("MoreMsg", { fg = c.gray })
hi("CursorLine", { bg = c.select })
hi("ColorColumn", { bg = c.select })
hi("Folded", { fg = c.dim, bg = "NONE" })
hi("FoldColumn", { fg = c.dark, bg = "NONE" })

-- Diff ← pi toolDiffAdded / toolDiffRemoved
hi("DiffAdd", { fg = c.ash })
hi("DiffDelete", { fg = c.creamPeach })
hi("DiffChange", { fg = c.gray })
hi("DiffText", { fg = c.cream, bold = true })
hi("Added", { fg = c.ash })
hi("Removed", { fg = c.creamPeach })
hi("Changed", { fg = c.gray })

-- Legacy syntax ← pi syntax* tokens
hi("Comment", { fg = c.dim, italic = true }) -- syntaxComment
hi("Keyword", { fg = c.ash }) -- was redLight → ash
hi("Statement", { fg = c.ash })
hi("Conditional", { fg = c.ash })
hi("Repeat", { fg = c.ash })
hi("Label", { fg = c.ash })
hi("Exception", { fg = c.ash })
hi("PreProc", { fg = c.ash })
hi("Include", { fg = c.ash })
hi("Define", { fg = c.ash })
hi("Macro", { fg = c.ash })
hi("Function", { fg = c.cream }) -- syntaxFunction
hi("Identifier", { fg = c.cream }) -- syntaxVariable
hi("String", { fg = c.paleOak }) -- syntaxString
hi("Character", { fg = c.paleOak })
hi("Number", { fg = c.cream }) -- syntaxNumber
hi("Float", { fg = c.cream })
hi("Boolean", { fg = c.ash })
hi("Type", { fg = c.cyan }) -- syntaxType
hi("StorageClass", { fg = c.ash })
hi("Structure", { fg = c.cyan })
hi("Typedef", { fg = c.cyan })
hi("Operator", { fg = c.gray }) -- syntaxOperator
hi("Delimiter", { fg = c.gray }) -- syntaxPunctuation
hi("Special", { fg = c.gray })
hi("SpecialChar", { fg = c.gray })
hi("Constant", { fg = c.cream })
hi("Todo", { fg = c.ash, bold = true })
hi("Error", { fg = c.redLight })
hi("Underlined", { fg = c.gray, underline = true })

-- Treesitter
hi("@comment", { link = "Comment" })
hi("@keyword", { link = "Keyword" })
hi("@keyword.function", { link = "Keyword" })
hi("@keyword.return", { link = "Keyword" })
hi("@function", { link = "Function" })
hi("@function.builtin", { link = "Function" })
hi("@function.call", { link = "Function" })
hi("@method", { link = "Function" })
hi("@method.call", { link = "Function" })
hi("@variable", { link = "Identifier" })
hi("@variable.parameter", { link = "Identifier" })
hi("@variable.builtin", { fg = c.gray })
hi("@string", { link = "String" })
hi("@number", { link = "Number" })
hi("@boolean", { link = "Boolean" })
hi("@type", { link = "Type" })
hi("@type.builtin", { fg = c.cyan })
hi("@type.definition", { link = "Type" })
hi("@operator", { link = "Operator" })
hi("@punctuation", { link = "Delimiter" })
hi("@punctuation.bracket", { link = "Delimiter" })
hi("@punctuation.delimiter", { link = "Delimiter" })
hi("@constant", { link = "Constant" })
hi("@property", { fg = c.cream })
hi("@field", { fg = c.cream })
hi("@namespace", { fg = c.cream })
hi("@module", { fg = c.cream })
hi("@include", { link = "Include" })
hi("@preproc", { link = "PreProc" })

-- Git / neo-tree (match pi ash + cream peach)
hi("NeoTreeGitAdded", { fg = c.ash })
hi("NeoTreeGitModified", { fg = c.paleOak })
hi("NeoTreeGitDeleted", { fg = c.creamPeach })
hi("NeoTreeGitUntracked", { fg = c.ash })
hi("GitSignsAdd", { fg = c.ash })
hi("GitSignsChange", { fg = c.paleOak })
hi("GitSignsDelete", { fg = c.creamPeach })
