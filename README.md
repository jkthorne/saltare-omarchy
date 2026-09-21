# saltare.workspace

An [Omarchy](https://omarchy.org) plugin for a [Saltare](https://saltare.ai)
workspace. A bar widget — unread channels, the mentions waiting for you, what
is due today, and how much mail is unread; click a row and you land in it. And
a capture field on a keystroke, which decides for itself where what you typed
should go.

```
◈ 13
┌─────────────────────────────────────┐
│ Acme      13 unread · 1 mention · … │
│ 4 unread mail in Ada Lovelace       │
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
│ j/k move · enter open · t terminal  │
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
go install github.com/jkthorne/saltare-cli/cmd/sal@latest
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

Every state but one names the command that ends it. In precedence order, which
is the order they are decided in:

| State | What happened | What it says |
|---|---|---|
| probing | the lookup for `sal` hasn't returned | Checking — the frame or two it takes, and no fix, because there is nothing yet to fix |
| setup | `sal` isn't installed | Install the CLI, then reload the shell |
| unsupported | the file came from a newer `sal` than this | Update the plugin |
| unreadable | the file is there and will not parse | The parser's own reason, and `sal watch --once` to rewrite it |
| signin | no session, or the session expired | Sign in — opens a terminal on `sal login` |
| stopped | the watcher isn't running | Start it — the last counts stay on screen, struck through |
| blocked | the server answered, and refused | The server's own sentence, and `sal doctor` |
| offline | the server is unreachable | Names the server and how old the numbers are |
| ok | — | the workspace |

Four of those are the order arguing with itself. **A stopped watcher keeps its
last counts** rather than dropping to zero: a bar that blanks when its feed
dies has told you something false. **Sign-in outranks a stale file**, because
restarting a watcher that has nothing to sign in with fixes nothing. **A server
that answered and refused is blocked, not offline** — saying offline there
sends you to check a connection that was never the problem, which is exactly
what the daemon's first live run did against a workspace at its monthly cap.
And **a file that will not parse is not a missing session**, so it stopped
offering `sal login`, which could not have repaired it.

## Mail

The count comes from the workspace's own mailbox — the one posta reads on the
phone — so the widget needs nothing new to show it.

It is a line and not a section, and that is the design rather than an
oversight. **Every row in the popup runs a command on enter**, and a mail row
could not: there is no mail client on this desktop and no web mailbox on the
server. A section of rows that open nothing is a door painted on a wall. It is
also not a fifth count in the header, because four already elide `1 due today`
to `1 due toda…` at that width; a line of its own has room to name the account,
which is the part a bare number cannot do.

**It can be missing, and that is fine.** Mail needs the `mail:read` scope,
which joined the CLI grant after most sessions were minted — and a session
keeps the scopes it was born with. If yours predates it, the line is simply
absent and everything else is unaffected. `sal login` again if you want it.

## Capture

Bind it in `~/.config/hypr/bindings.lua` — the keybind is yours, so the plugin
cannot ship it:

```lua
o.bind("SUPER + SHIFT + S", "Saltare capture", "omarchy-shell shell toggle saltare.workspace")
```

**Not `SUPER + S`** — that is Omarchy's scratchpad toggle, and taking a stock
binding to gain a mnemonic is a bad trade. Check yours with
`omarchy menu keybindings --print` before choosing; if you want a key that is
already bound, `hl.unbind` it on the line above.

One field. What you type decides where it goes, and the line under the field
tells you where before you commit:

| You type | Where it goes |
|---|---|
| `#general ship it` | a message in #general |
| `@researcher what changed?` | that agent's DM |
| `! fix the deploy` | a task, self-assigned |
| `!2026-09-20 ship the plugin` | a task, due then |
| `/doc Q3 notes` | a new document |
| `?march receipt` | a search, answered in place |
| `?chen` | the same search — people included |
| `what broke last night` | Claude, answered in place |

`?` is the only sigil that pulls rather than pushes, and it is why there is no
second widget for notes, files or photos: one search spans messages, tasks,
documents, uploads and the people in the workspace, so the field that captures
a thought also finds one — or finds whose desk to put it on.

**The results are rows, and every row opens.** `↑`/`↓` move, `enter` opens the
selected one — in a browser, or in `sal` itself; see [Where a row
opens](#where-a-row-opens) — and `esc` closes. A message goes to its place in its
channel, a task to the task, a person to their directory entry, and a document
or file to its address in the data tree — or, for anything made through the
API, to its own editor, since nothing `/doc` creates has a tree address. A hit
with nothing to open is not drawn at all.

This needs a `sal` new enough to answer `sal search --json` and to know the
`member`, `data`, `document` and `upload` kinds of `sal open`. An older one
returns no rows.

No sigil means ask. That is deliberate: the common case for a field you
summoned with a keystroke is a thought, and making the common case the one
with no sigil is what makes the sigils worth learning. `enter` sends, `esc`
closes and keeps nothing, and `ctrl+c` stops an answer mid-stream — the rest
of the time it copies, because a field whose whole job is what you typed has
no business taking the key that copies it. A command that fails leaves your
text in the field — losing what someone typed is the one unforgivable failure
for a capture field.

## Keys

`j`/`k` move · `enter` opens the row · `t` opens it in the terminal ·
`x` completes the selected task · `r` re-reads the file and re-checks for
`sal` · `o` opens the workspace in a browser. Right-click the bar icon to
re-check without opening the panel.

This popup is a summary; `sal` is a client. Everything the summary cannot hold
— the feed, threads, documents, the assistant — is one key away rather than
something this widget has to grow into.

## Where a row opens

`enter` runs `sal open`, and **`sal` decides where that lands**:

```json
// ~/.config/saltare/config.json
{ "open_target": "tui" }
```

The setting is there rather than here on purpose. `sal open` is also what a
notification's click action runs and what a shell script reaches for, so a
switch in this plugin's settings would move the rows in this popup and leave
every other caller opening a browser. One answer, in the process that holds the
session.

**`t` insists on the terminal** whatever that key says — `sal open --tui` on
the selected row, and with no row under the cursor, `sal` itself. A key whose
whole job is to be the other door has to be the other door every time.

Either way you end up with **one terminal, not a stack of them**. A running
`sal` listens on a socket in the runtime directory, so a row that resolves to
the terminal moves the window you already have open; only when there is none
does anything get launched. The window it launches gets the app-id
`org.saltare.sal` — that is what a later focus matches on, what a Hyprland
window rule should name, and a string this repo and `saltare-cli` have to
agree on, so the tests here read theirs and check.

**Two kinds always open on the web.** A person and a data-tree node have pages
there and no screen in `sal`, so they fall back rather than landing you in a
terminal that cannot draw what you clicked. Everything else — channels, tasks,
messages, agents, documents, uploads — the TUI can show.

## Settings

Setup → Plugins → Saltare, or by hand in `~/.config/omarchy/shell.json`.

| Key | Default | What |
|---|---|---|
| `statePath` | `$XDG_STATE_HOME/saltare/watch.json` | where the daemon publishes |
| `showWhenIdle` | `true` | off hides the widget until something is unread, mentioning you, overdue or due today |
| `staleAfterSec` | `0` | how long before a quiet watcher counts as a stopped one — 0 follows the daemon's own heartbeat, three missed beats, the rule `sal status` uses |

## Without Omarchy

The daemon is not Omarchy-specific. `sal status --waybar --follow` is a waybar
custom module reading the same file, and `sal status` is a line for a shell
prompt. Neither needs this plugin.

## Hacking

```sh
bin/ci                          # the gate — everything this machine can run
node --test tests/*.test.js     # just the logic
omarchy plugin validate .       # just the manifest
```

There are two test files; `tests/model.test.js` alone leaves the capture
grammar unrun.

### Seeing every state without breaking anything

The widget is a renderer over one JSON document, so every state it can be in is
reachable by writing that document — no expired session, no unplugged network,
no waiting for a workspace to go quiet.

```sh
omarchy bar set saltare.workspace statePath /tmp/saltare-demo.json
bin/demo-states --all          # ↵ between states, watch the bar
omarchy bar set saltare.workspace statePath ""
```

`bin/demo-states --list` names each one and what you should see. Walk the list
before shipping a change: the states nobody exercises are the ones that rot,
and `probing` only exists because running it once showed the widget telling a
machine with `sal` installed to go and install it. Seven of the nine states in
the table above are reachable this way; `setup` and `probing` are about the CLI
rather than the file, so they are not.

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

## License

MIT.
