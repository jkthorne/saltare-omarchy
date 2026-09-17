# saltare.workspace

An [Omarchy](https://omarchy.org) bar widget for a [Saltare](https://saltare.ai)
workspace: unread channels, the mentions waiting for you, and what is due
today. Click a row and you land in it.

```
◈ 13
┌─────────────────────────────────────┐
│ Acme      13 unread · 1 mention · … │
│ MENTIONS                            │
│   Alice Chen mentioned you in       │
│   #general                          │
│ UNREAD                              │
│   #engineering                    9 │
│   #general                        3 │
│   Alice Chen                      1 │
│ WORK                                │
│   Fix the deploy         2026-09-14 │
│   Ship the Omarchy plugin    today  │
│ j/k move · enter open · x complete  │
└─────────────────────────────────────┘
```

## It holds no credentials

The widget makes no network requests and stores no token. It reads one JSON
file that the [`sal`](https://github.com/jkthorne/saltare-cli) CLI publishes,
and it shells out to `sal` for anything that changes the workspace.

That is not caution for its own sake. Omarchy plugins run unsandboxed inside
`omarchy-shell`, sharing a QML scene that every other visual plugin can
traverse — so the safest place for an access token is a different process. The
tests enforce it: `Watch.qml` may not contain `XMLHttpRequest`, `WebSocket`, or
an access token, and neither may anything else here.

It also means the widget is correct on a multi-monitor desk. A bar widget is
instantiated once per monitor; one that opened its own connection would open
two and announce every mention twice.

## Install

```sh
# 1. the CLI that holds the session
go install github.com/jkthorne/saltare-cli/cmd/sal@latest   # or a release tarball
sal login --server https://saltare.ai

# 2. the watcher that publishes the state file
sal watch --install-service

# 3. this widget
omarchy plugin add https://github.com/jkthorne/saltare-omarchy.git --enable --yes
```

Step 2 writes `~/.config/systemd/user/saltare-watch.service` and starts it.
The installer for step 3 deliberately runs no code of ours — Omarchy clones
files and nothing else — which is why the CLI sets itself up and the plugin
does not.

If you do them out of order nothing breaks: the widget shows the step you are
missing and the command that completes it.

## What it shows when something is wrong

Every state names the command that ends it.

| State | What happened | What it says |
|---|---|---|
| setup | `sal` isn't installed | Install the CLI, then reload the shell |
| signin | no session, or the session expired | Sign in — opens a terminal on `sal login` |
| stopped | the watcher isn't running | Start it — the last counts stay on screen, struck through |
| offline | the server is unreachable | Names the server and how old the numbers are |
| ok | — | the workspace |

Two of those are deliberate. **A stopped watcher keeps its last counts**
rather than dropping to zero: a bar that blanks when its feed dies has told
you something false. And **sign-in outranks a stale file**, because restarting
a watcher that has nothing to sign in with fixes nothing.

## Keys

`j`/`k` move · `enter` opens the row · `x` completes the selected task ·
`r` re-reads the file and re-checks for `sal` · `o` opens the workspace in a
browser. Right-click the bar icon to re-check without opening the panel.

## Settings

Setup → Plugins → Saltare, or by hand in `~/.config/omarchy/shell.json`.

| Key | Default | What |
|---|---|---|
| `statePath` | `$XDG_STATE_HOME/saltare/watch.json` | where the daemon publishes |
| `showWhenIdle` | `true` | off hides the widget until something is waiting |
| `staleAfterSec` | `120` | how long before a quiet watcher counts as a stopped one |

## Without Omarchy

The daemon is not Omarchy-specific. `sal status --waybar --follow` is a waybar
custom module reading the same file, and `sal status` is a line for a shell
prompt. Neither needs this plugin.

## Hacking

```sh
node --test tests/model.test.js    # all of the logic
omarchy plugin validate .          # the manifest
```

`Model.js` holds every decision — which state we are in, what the badge says,
what each row runs — as pure functions, and the QML is a renderer over it.
Omarchy's plugin API is young; the parts worth protecting from it are the parts
that decide things. Saving any file under `~/.config/omarchy/plugins/` reloads
the code.

`tests/fixtures/watch.json` is byte-identical to `saltare-cli`'s
`internal/watch/testdata/golden.json`. That is the contract between the two
repos: a schema change that lands on one side fails on the other.

Two things about the edit loop, both learned the hard way:

- **Do not symlink your checkout into `~/.config/omarchy/plugins/`.** The shell
  watches that directory with inotify, which does not follow symlinks, so your
  edits never trigger a reload. Copy the tree in.
- **`omarchy-shell shell rescanPlugins` is not always enough.** It reloaded a
  cached compiled component here across several edits, reporting warnings
  against line numbers the file no longer had. When a change seems not to take,
  `omarchy-restart-shell` and trust that.

The state table above is not decoration — walk all six states before shipping a
change. `probing` exists because running it revealed the widget told a machine
with `sal` installed to go and install it, for as long as the lookup took.

## License

MIT.
