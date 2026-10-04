---@type LazySpec
return {
  "sphamba/smear-cursor.nvim",
  event = "VeryLazy",
  opts = {
    -- Use the active colorscheme's Cursor highlight (the plugin default).
    never_draw_over_target = true,
    smear_insert_mode = false,
    min_vertical_distance_smear = 2,
    min_horizontal_distance_smear = 2,
    time_interval = 17,
    stiffness = 0.9,
    trailing_stiffness = 0.4,
    damping = 0.99,
  },
}
