-- Run: nvim --headless -u nvim/init.lua -l nvim/tests/background.lua
local image, terminal = Snacks.image, Snacks.image.terminal
local supports, env, size = image.supports, terminal.env, terminal.size
local request, write, uis = terminal.request, terminal.write, vim.api.nvim_list_uis
local requests, writes = {}, {}
-- Keep real Neovim buffers/events; capture graphics instead of writing to a TTY.
terminal.request = function(opts) requests[#requests + 1] = vim.deepcopy(opts) end
terminal.write = function(data) writes[#writes + 1] = data end
terminal.size = function() return { cell_width = 10, cell_height = 20 } end
terminal.env = function() return { remote = false } end
image.supports = function() return true end
local normal = vim.api.nvim_get_hl(0, { name = "Normal", link = false })

local function event(name, data)
  vim.api.nvim_exec_autocmds(name, { group = "NvimBackground", data = data })
end
local function drain()
  local done = false
  vim.schedule(function() done = true end)
  assert(vim.wait(500, function() return done end), "scheduled work did not run")
end
local function start()
  event("UIEnter")
  drain()
  drain() -- startup schedules the initial placement
end

start()
assert(#requests == 0, "headless startup must not emit graphics")
vim.api.nvim_list_uis = function() return { {} } end
image.supports = function() return false end
start()
assert(#requests == 0, "unsupported terminals must not emit graphics")
image.supports = function() return true end
terminal.env = function() return { remote = true } end
start()
assert(#requests == 0, "do not send local file paths to remote terminals")
terminal.env = function() return { remote = false } end

-- Startup works in an editor buffer, without ever opening the homepage.
vim.cmd.enew()
vim.o.columns, vim.o.lines = 80, 24
start()
assert(requests[1].a == "t" and requests[1].t == "f" and requests[1].f == 100)
local src = vim.base64.decode(requests[1].data)
assert(vim.fn.filereadable(src) == 1)
local dimensions = image.util.dim(src)
assert(dimensions.width > 0 and dimensions.width * 9 == dimensions.height * 16, "keep the 16:9 artwork")

local scale = 0
local function placement()
  event("VimResized")
  event("SafeState")
  drain()
  local p = requests[#requests]
  assert(p.a == "p" and p.z == -1 and p.C == 1, "draw behind text without moving its cursor")
  assert(p.c == vim.o.columns and p.r == vim.o.lines, "span the entire UI, not one split")
  assert(p.x >= 0 and p.y >= 0 and p.x + p.w <= dimensions.width and p.y + p.h <= dimensions.height)
  scale = math.max(scale, p.c * 10 / dimensions.width, p.r * 20 / dimensions.height)
  assert(math.abs(p.w * scale - p.c * 10) <= scale, "do not stretch horizontally or zoom out")
  assert(math.abs(p.h * scale - p.r * 20) <= scale, "do not stretch vertically or zoom out")
  assert(writes[#writes - 1] == "\27[1;1H" and writes[#writes] == "\27" .. "8", "anchor at screen origin and restore cursor")
  return p
end

local first = placement()
local idle_requests = #requests
for _ = 1, 5 do event("SafeState") end
drain()
assert(#requests == idle_requests, "idle callbacks must not repaint indefinitely")
vim.o.columns, vim.o.lines = 50, 15
local smaller = placement()
assert(smaller.w < first.w and smaller.h < first.h)
vim.o.columns, vim.o.lines = 120, 40
placement()
vim.o.columns, vim.o.lines = 32, 30
placement()

-- Changes of file, split, tab, and homepage never delete or retransmit the image.
Snacks.dashboard.open({ win = 0 })
vim.cmd.enew()
vim.cmd.vsplit()
vim.cmd.tabnew()
vim.cmd.redraw({ bang = true })
placement()
for index, packet in ipairs(requests) do
  assert(packet.i == first.i and (index == 1 or packet.a == "p"), "reuse one background across buffers and panes")
end
assert(vim.deep_equal(normal, vim.api.nvim_get_hl(0, { name = "Normal", link = false })), "leave theme opacity unchanged")
assert(requests[#requests].q == 1, "cached placements must report a missing image")

-- Recover only our image; a failed fresh upload must not create an error loop.
local before_recovery = #requests
event("TermResponse", { sequence = "\27_Gi=1,p=1;ENOENT: image not found\27\\" })
drain()
assert(#requests == before_recovery, "ignore errors for other plugins' images")
event("TermResponse", { sequence = "\27_Gp=1,i=" .. first.i .. ";ENOENT: image not found\27\\" })
drain()
assert(requests[before_recovery + 1].a == "t", "reupload data removed by the terminal")
assert(requests[#requests].a == "p" and requests[#requests].q == 2, "silence errors for the recovery attempt")
event("SafeState")
drain()
assert(#requests == before_recovery + 2, "recovery must stop without additional input")

event("VimEnter") -- UIEnter and VimEnter must not install the renderer twice.
drain()
event("ExitPre") -- An aborted :quit must not remove the background.
assert(requests[#requests].a == "p")

-- Suspending hides the image; a pending repaint must not leak onto the shell.
event("VimResized")
event("VimSuspend")
assert(requests[#requests].a == "d" and requests[#requests].d == "I")
local count = #requests
drain()
assert(#requests == count)
event("VimResume")
drain()
assert(requests[count + 1].a == "t" and requests[#requests].a == "p")

event("VimResized")
event("VimLeavePre")
assert(requests[#requests].a == "d" and requests[#requests].d == "I")
count = #requests
drain()
assert(#requests == count, "queued work must not redraw after exiting")

image.supports, terminal.env, terminal.size = supports, env, size
terminal.request, terminal.write, vim.api.nvim_list_uis = request, write, uis
assert(vim.v.errmsg == "", vim.v.errmsg)
print("full-UI backdrop, cover crop, non-shrinking resize, buffer transitions, suspend, and exit: ok")
