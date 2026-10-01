"""Run from the repo root: python3 nvim/tests/background-pty.py.

Exercise the real TUI with a simulated Ghostty capability response. This tests
startup, cache recovery, idle redraw loops, and cleanup, not actual GPU pixels.
"""
import errno
import fcntl
import os
import pty
import re
import select
import signal
import struct
import subprocess
import termios
import time

master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 800, 480))
env = dict(os.environ, TERM="xterm-256color", TERM_PROGRAM="ghostty", COLORTERM="truecolor")
proc = subprocess.Popen(
    ["nvim", "-u", "nvim/init.lua", "README.md"],
    stdin=slave, stdout=slave, stderr=slave, env=env, start_new_session=True,
)
os.close(slave)
output = bytearray()
queries = 0
processed = 0
images = set()
visible = False
missing = 0


def terminal_events():
    """Model Ghostty's image-cache deletion on ED2/ED3, not just packet order."""
    global processed, visible, missing
    # Ghostty 1.3.1 Terminal.eraseDisplay calls kitty_images.delete(.all=true).
    pattern = rb"\x1b\[[23]J|\x1b_G([^;\x1b]+)(?:;[^\x1b]*)?\x1b\\"
    offset = processed
    for match in re.finditer(pattern, output[offset:]):
        processed = offset + match.end()  # Leave partial sequences for the next read.
        if match[1] is None:
            images.clear()
            visible = False
            continue
        fields = dict(field.split(b"=", 1) for field in match[1].split(b","))
        image_id = fields.get(b"i", b"0")
        if int(image_id) < 0x40000000:
            continue
        action = fields.get(b"a")
        if action == b"t":
            images.add(image_id)
        elif action == b"p":
            visible = image_id in images
            if not visible:
                missing += 1
                if fields.get(b"q") != b"2":
                    os.write(master, b"\x1b_Gi=" + image_id + b",p=1;ENOENT: image not found\x1b\\")
        elif action == b"d" and fields.get(b"d") == b"I":
            images.discard(image_id)
            visible = False


def pump(seconds):
    global queries
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        ready = select.select([master], [], [], max(0, min(0.05, end - time.monotonic())))[0]
        if not ready:
            continue
        try:
            chunk = os.read(master, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                return
            raise
        if not chunk:
            return
        output.extend(chunk)
        total = output.count(b"\x1b[>q")
        for _ in range(total - queries):
            os.write(master, b"\x1bP>|ghostty 1.3.1\x1b\\")
        queries = total
        terminal_events()
        graphics = output.count(b"\x1b_G")
        assert len(output) < 2_000_000, f"possible redraw loop: {graphics} graphics messages"


def packets():
    result = []
    for match in re.finditer(rb"\x1b_G([^;\x1b]+)(?:;[^\x1b]*)?\x1b\\", output):
        fields = dict(field.split(b"=", 1) for field in match[1].split(b","))
        # Modern Neovim forks its editor from the TUI, so getpid() differs
        # from Popen.pid. The background reserves IDs above Snacks' range.
        if int(fields.get(b"i", b"0")) >= 0x40000000:
            result.append(fields)
    return result


try:
    pump(4)
    first = packets()
    assert any(p.get(b"a") == b"t" for p in first), "no startup image transmission"
    assert any(
        p.get(b"a") == b"p" and p.get(b"c") == b"80" and p.get(b"r") == b"24" for p in first
    ), "no full-screen placement on file startup"
    count = len(first)
    pump(1)
    idle = len(packets()) - count
    assert idle < 20, f"idle redraw loop: {idle} graphics requests per second"
    os.write(master, b":vsplit\r:redraw!\r")
    pump(1)
    assert len(packets()) > count + idle, "no redraw after split/full repaint"
    last_placement = max(
        match.start() for match in re.finditer(rb"\x1b_G([^;\x1b]+)", output)
        if b"a=p" in match[1]
    )
    assert last_placement > output.rfind(b"\x1b[2J"), "screen clear erased the final placement"
    assert visible, "full redraw deleted the cached image; placement alone cannot restore it"
    # Real terminal resizes, not just changes to options in a headless editor.
    for columns, rows in [(60, 18), (120, 40), (40, 30)]:
        count = len(packets())
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, columns * 10, rows * 20))
        os.kill(proc.pid, signal.SIGWINCH)
        pump(1)
        resized = packets()[count:]
        assert resized and resized[-1].get(b"a") == b"p", "resize did not repaint the image"
        assert resized[-1][b"c"] == str(columns).encode() and resized[-1][b"r"] == str(rows).encode()
        last_placement = max(
            match.start() for match in re.finditer(rb"\x1b_G([^;\x1b]+)", output)
            if b"a=p" in match[1]
        )
        assert last_placement > output.rfind(b"\x1b[2J"), "resize cleared the image after its final placement"
        assert visible, "resize deleted the cached image without recovery"

    # Dragging a pane produces overlapping resize/redraw/response sequences.
    for columns in range(45, 86, 5):
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 28, columns, columns * 10, 560))
        os.kill(proc.pid, signal.SIGWINCH)
        pump(0.03)
    pump(0.7)
    assert visible, "rapid pane resizing lost the background"
    assert missing > 0, "test must exercise missing-image recovery"
    os.write(master, b":qa!\r")
    pump(2)
    proc.wait(timeout=5)
    final = packets()[-1]
    assert final.get(b"a") == b"d" and final.get(b"d") == b"I", "exit did not free image"
    assert proc.returncode == 0, proc.returncode
    print(f"PTY startup, redraw, resize/cache recovery, and exit: ok; {idle} idle graphics requests in 1s")
finally:
    if proc.poll() is None:
        proc.kill()
        proc.wait()
    os.close(master)
