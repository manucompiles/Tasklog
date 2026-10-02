# Tasklog watchman

The tape's sensor: a tiny local agent that samples the active window title +
idle state, spools locally, and ships to the Tasklog server so Sage can
arbitrate time boundaries from evidence. Metadata only - titles, never
contents. Nothing leaves the LAN.

Fresh service, no legacy data: the old Argonaut tracker keeps its own file and
is unrelated (retire it whenever).

## Install (per machine, X11 Linux)

```bash
# deps: xdotool + libXss + notify-send (usually present)
sudo apt install -y xdotool libxss1 libnotify-bin

mkdir -p ~/.config/systemd/user
cp watchman/tasklog-watchman.service ~/.config/systemd/user/
# edit the ExecStart path inside if the repo lives elsewhere
systemctl --user daemon-reload
systemctl --user enable --now tasklog-watchman
```

Config appears at `~/.config/tasklog-watchman/config.json` on first run:
server URL, machine name, poll rate, and the alert rules (v1: pattern +
minutes-in-window + cooldown; `"enabled": false` turns popups off). Spool and
ship cursor live in `~/.local/state/tasklog-watchman/`.

## Future versions grow here

- more alert patterns and server-driven rules
- site blocking hooks
- per-machine dashboards from `/api/activity/segments`
