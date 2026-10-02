-- Keep upstream palettes; only Everforest's dashboard shortcuts are monochrome.
---@type LazySpec
return {
  "AstroNvim/astroui",
  opts = {
    colorscheme = "everforest",
    highlights = {
      everforest = {
        SnacksDashboardDesc = { link = "Normal" },
        SnacksDashboardIcon = { link = "Normal" },
        SnacksDashboardKey = { link = "Normal" },
      },
    },
  },
}
