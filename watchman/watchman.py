#!/usr/bin/env python3
"""
Tasklog watchman - the tape's sensor + shipper (v4.1, #92).

LOCAL, metadata-only, single-user. Every POLL seconds it samples:
  - idle time via the X ScreenSaver extension (no input = idle)
  - the active window TITLE (never contents, never keystrokes)
spools each sample to a local jsonl, and ships unshipped lines to the Tasklog
server in batches (idempotent server-side: resending is always safe). The
laptop sleeps 00:00-06:00 IST - the spool absorbs that and catches up.

Alerts (v1, config-driven): when one alertable pattern (YouTube, by default)
has been on screen for more than `minutes` within the rolling `window_minutes`,
a desktop popup fires (notify-send), at most once per `cooldown_minutes`.
Future versions grow here: more patterns, server-driven rules, site blocking.

Config: ~/.config/tasklog-watchman/config.json (created with defaults on first
run - edit and restart). Nothing leaves the LAN.
"""
import ctypes
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime

CONFIG_DIR = os.path.expanduser("~/.config/tasklog-watchman")
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")
STATE_DIR = os.path.expanduser("~/.local/state/tasklog-watchman")
SPOOL = os.path.join(STATE_DIR, "spool.jsonl")
CURSOR = os.path.join(STATE_DIR, "cursor")

DEFAULTS = {
    "server": "http://192.168.1.49",
    "machine": "pc",
    "poll_seconds": 30,
    "ship_every_samples": 4,
    "idle_threshold_seconds": 300,
    "alerts": {
        "enabled": True,
        "patterns": ["youtube"],
        "minutes": 60,
        "window_minutes": 90,
        "cooldown_minutes": 60,
    },
}


def load_config():
    os.makedirs(CONFIG_DIR, exist_ok=True)
    if not os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "w") as f:
            json.dump(DEFAULTS, f, indent=2)
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    merged = {**DEFAULTS, **cfg}
    merged["alerts"] = {**DEFAULTS["alerts"], **cfg.get("alerts", {})}
    return merged


# ---- X11 idle + active window (the proven libXss approach) ----

class _XSI(ctypes.Structure):
    _fields_ = [("window", ctypes.c_ulong), ("state", ctypes.c_int), ("kind", ctypes.c_int),
                ("til_or_since", ctypes.c_ulong), ("idle", ctypes.c_ulong), ("event_mask", ctypes.c_ulong)]


def _load(*names):
    for n in names:
        try:
            return ctypes.CDLL(n)
        except OSError:
            continue
    raise OSError(f"could not load any of: {names!r}")


_x = _load("libX11.so.6", "libX11.so.1")
_xss = _load("libXss.so.1")
_x.XOpenDisplay.restype = ctypes.c_void_p
_x.XOpenDisplay.argtypes = [ctypes.c_char_p]
_x.XDefaultRootWindow.restype = ctypes.c_ulong
_x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
_xss.XScreenSaverAllocInfo.restype = ctypes.c_void_p
_xss.XScreenSaverQueryInfo.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_void_p]


def idle_seconds():
    dpy = _x.XOpenDisplay(None)
    if not dpy:
        return 0
    try:
        info = _xss.XScreenSaverAllocInfo()
        _xss.XScreenSaverQueryInfo(dpy, _x.XDefaultRootWindow(dpy), info)
        return ctypes.cast(info, ctypes.POINTER(_XSI)).contents.idle // 1000
    finally:
        _x.XCloseDisplay(dpy)


def active_window():
    try:
        out = subprocess.run(
            ["xdotool", "getactivewindow", "getwindowname"],
            capture_output=True, text=True, timeout=5,
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


# ---- spool + ship ----

def append_sample(sample):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(SPOOL, "a") as f:
        f.write(json.dumps(sample) + "\n")


def read_cursor():
    try:
        with open(CURSOR) as f:
            return int(f.read().strip())
    except Exception:
        return 0


def write_cursor(n):
    with open(CURSOR, "w") as f:
        f.write(str(n))


def ship(cfg):
    if not os.path.exists(SPOOL):
        return
    cursor = read_cursor()
    with open(SPOOL) as f:
        lines = f.read().splitlines()
    pending = lines[cursor:]
    if not pending:
        return
    # Batches of 1000; stop at the first failure (server asleep) - the cursor
    # only advances past what the server acknowledged.
    for i in range(0, len(pending), 1000):
        chunk = [json.loads(l) for l in pending[i:i + 1000]]
        body = json.dumps({"machine": cfg["machine"], "samples": chunk}).encode()
        req = urllib.request.Request(
            cfg["server"].rstrip("/") + "/api/activity/batch",
            data=body, headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                if res.status != 200:
                    return
        except Exception:
            return  # server unreachable (asleep) - the spool waits
        write_cursor(cursor + i + len(chunk))


# ---- alerts (v1) ----

_last_alert_at = 0.0


def maybe_alert(cfg, recent):
    """recent: list of (epoch, win_lower, active). Popup when an alertable
    pattern exceeded its budget inside the rolling window."""
    global _last_alert_at
    a = cfg["alerts"]
    if not a.get("enabled"):
        return
    now = time.time()
    if now - _last_alert_at < a["cooldown_minutes"] * 60:
        return
    horizon = now - a["window_minutes"] * 60
    poll = cfg["poll_seconds"]
    for pattern in a["patterns"]:
        seconds = sum(poll for (ts, win, active) in recent
                      if ts >= horizon and active and pattern in win)
        if seconds >= a["minutes"] * 60:
            mins = seconds // 60
            try:
                subprocess.run([
                    "notify-send", "-u", "critical", "-a", "Tasklog",
                    "The tape noticed",
                    f"{pattern} has had {mins} of the last {a['window_minutes']} minutes. "
                    "Just a mirror, not a judgment.",
                ], timeout=5)
            except Exception:
                pass
            _last_alert_at = now
            return


def main():
    cfg = load_config()
    poll = cfg["poll_seconds"]
    recent = []  # rolling in-memory tail for alert math
    ship_counter = 0
    print(f"watchman up: machine={cfg['machine']} server={cfg['server']} poll={poll}s", flush=True)
    while True:
        idle = idle_seconds()
        active = idle < cfg["idle_threshold_seconds"]
        win = active_window() if active else ""
        sample = {
            "ts": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            "win": win,
            "idleS": int(idle),
            "state": "active" if active else "idle",
        }
        append_sample(sample)
        recent.append((time.time(), win.lower(), active))
        cutoff = time.time() - cfg["alerts"]["window_minutes"] * 60 - 300
        recent = [r for r in recent if r[0] >= cutoff]
        maybe_alert(cfg, recent)

        ship_counter += 1
        if ship_counter >= cfg["ship_every_samples"]:
            ship(cfg)
            ship_counter = 0
        time.sleep(poll)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
