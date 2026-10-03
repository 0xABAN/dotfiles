-- One image behind the entire Neovim UI, not one image per window.
-- Reuse Snacks' graphics transport; text and terminal opacity stay unchanged.
local group = vim.api.nvim_create_augroup("NvimBackground", { clear = true })
local started = false

local function start()
  if started or #vim.api.nvim_list_uis() == 0 then return end
  started = true -- Capability detection can yield; avoid overlapping startups.

  local src = vim.fn.stdpath("config") .. "/assets/background.png"
  local terminal = Snacks.image.terminal
  if vim.fn.filereadable(src) == 0 or not Snacks.image.supports(src) or terminal.env().remote then
    started = false
    return -- Unsupported terminals and SSH keep the ordinary opaque theme.
  end

  local dimensions = Snacks.image.util.dim(src)
  -- Snacks uses 24-bit image IDs; reserve a separate ID for this Neovim process.
  local id = 0x40000000 + vim.fn.getpid()
  local scale, sent, paused = 0, false, false
  local needs_paint = true
  local namespace = vim.api.nvim_create_namespace("NvimBackground")

  local function hide()
    paused = true
    if sent then
      terminal.request({ a = "d", d = "I", i = id })
      sent = false
    end
  end

  local function paint()
    if paused or not needs_paint then return end
    needs_paint = false

    local columns, rows = vim.o.columns, vim.o.lines
    local cell = terminal.size()
    local width = columns * (cell.cell_width > 0 and cell.cell_width or 9)
    local height = rows * (cell.cell_height > 0 and cell.cell_height or 18)

    -- Keep the largest scale for this session: smaller viewports crop more,
    -- larger ones may zoom in. Uniform scaling preserves the source aspect ratio.
    scale = math.max(scale, width / dimensions.width, height / dimensions.height)
    local crop_width = math.max(1, math.floor(width / scale))
    local crop_height = math.max(1, math.floor(height / scale))

    local uploaded = not sent
    if uploaded then
      terminal.request({ a = "t", t = "f", f = 100, i = id, data = Snacks.util.base64(src) })
      sent = true
    end
    terminal.write("\27" .. "7") -- preserve Neovim's terminal cursor
    terminal.set_cursor({ 1, 0 })
    terminal.request({
      a = "p", i = id, p = 1, C = 1, z = -1,
      -- Request errors for cached images, but silence a failed fresh upload
      -- so an unreadable asset cannot trigger an infinite recovery loop.
      q = uploaded and 2 or 1,
      c = columns, r = rows,
      x = math.floor((dimensions.width - crop_width) / 2),
      y = math.floor((dimensions.height - crop_height) / 2),
      w = crop_width, h = crop_height,
    })
    terminal.write("\27" .. "8")
  end
  local function draw()
    needs_paint = true
    vim.schedule(paint)
  end

  -- Ghostty's full-screen clear also frees image data. Recover a missing
  -- image after any clear or eviction, not only the resize that exposed it.
  vim.api.nvim_create_autocmd("TermResponse", {
    group = group,
    callback = function(event)
      local fields = event.data.sequence:match("^\27_G([^;]+);ENOENT:")
      if fields and tonumber(("," .. fields .. ","):match(",i=(%d+),")) == id then
        sent = false
        draw()
      end
    end,
  })

  -- SafeState can repeat while idle. Only input or layout/content events mark
  -- the image dirty, so our own graphics output cannot cause a repaint loop.
  vim.on_key(function() needs_paint = true end, namespace)
  vim.api.nvim_create_autocmd("SafeState", { group = group, callback = paint })
  vim.api.nvim_create_autocmd({ "VimResized", "WinResized", "WinScrolled", "BufEnter", "ColorScheme" }, {
    group = group, callback = draw,
  })
  vim.api.nvim_create_autocmd("VimSuspend", { group = group, callback = hide })
  vim.api.nvim_create_autocmd("VimResume", {
    group = group,
    callback = function()
      paused = false
      draw()
    end,
  })
  vim.api.nvim_create_autocmd("VimLeavePre", {
    group = group,
    callback = function()
      hide()
      vim.on_key(nil, namespace)
      vim.api.nvim_del_augroup_by_id(group)
    end,
  })
  draw()
end

-- Both empty and file-argument startups work; headless checks emit no graphics.
vim.api.nvim_create_autocmd({ "VimEnter", "UIEnter" }, {
  group = group, callback = function() vim.schedule(start) end,
})
