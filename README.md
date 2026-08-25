# Command Palette for herdr

An F1-style command palette for [herdr](https://herdr.dev). One key opens a popup listing
**every action from every installed plugin**, fuzzy-filtered as you type. Pick one, hit
enter, it runs.

```
❯ tele                                                                        2/13
──────────────────────────────────────────────────────────────────────────────────
▸ Edit Telegram notification settings      Telegram Notifications
  Send test Telegram message               Telegram Notifications

↑↓ select  ⏎ run  esc close
```

Zero dependencies — no `fzf`, no Python, just Node.

## Features

- Lists every action from every enabled plugin, grouped by plugin display name.
- Fuzzy search across action title, plugin name, description, and action id.
- Shows the key chord bound to each action, read from your `[[keys.command]]` entries.
- Most recently run actions float to the top.
- Hides actions that do not run on your platform.

## Install

```sh
herdr plugin install barnuri/herdr-command-palette
```

## Bind a key

Add this to `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "f1"
type = "plugin_action"
command = "barnuri.command-palette.open"
description = "command palette"
```

Then reload: `herdr server reload-config`.

`type = "plugin_action"` matters — the shell form (`herdr plugin pane open …`) skips the
plugin's own entrypoint and the palette loses the context it was opened from.

## Keys

| Key | Action |
|---|---|
| type | filter |
| `↑` `↓` / `ctrl+p` `ctrl+n` | move the selection |
| `page up` / `page down` | move a screen at a time |
| `⏎` | run the highlighted action |
| `ctrl+w` | delete the last word of the query |
| `ctrl+u` | clear the query |
| `esc` / `ctrl+c` | close without running anything |

## How it works

The `open` action runs server-side with no TTY, so all it does is open the popup. The popup
is where the palette actually draws — it is session-modal, gets every keystroke including
Escape, and closes when its process exits.

Because that popup is modal, the palette cannot run your chosen action itself: any action
that opens a pane or popup of its own would be refused with `ui_busy`. So it hands the
choice to a short-lived detached process and exits. By the time that process fires, the
popup is gone and focus is back where you started.

The popup launches through `bin/herdr-palette`, a POSIX `sh` trampoline. Plugin panes
inherit the *herdr server's* environment, and a server started by launchd or systemd has a
bare `PATH` where `node` is unreachable — the trampoline repairs it before exec'ing node.

Recently used actions are stored in `HERDR_PLUGIN_STATE_DIR/recents.json`.

## Development

```sh
git clone https://github.com/barnuri/herdr-command-palette.git
herdr plugin link ./herdr-command-palette
npm test
```

## License

MIT
