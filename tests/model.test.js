const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const Model = require("../Model.js")

// The fixture is byte-identical to saltare-cli's internal/watch/testdata/golden.json.
// That is the whole contract between the daemon and this widget: a schema
// change that lands on one side has to land on the other or one of them fails.
const fixturePath = path.join(__dirname, "fixtures", "watch.json")
const fixture = fs.readFileSync(fixturePath, "utf8")
const doc = JSON.parse(fixture)
const publishedAt = Date.parse(doc.updated_at)
const settings = { staleAfterSec: 0, showWhenIdle: true } // 0 = follow the daemon

function loaded() {
  return Model.parse(fixture)
}

// ── the seam ────────────────────────────────────────────────────────────

test("the golden document parses and carries the shape the widget draws", () => {
  const snapshot = loaded()
  assert.equal(snapshot.status, "loaded")
  assert.equal(snapshot.doc.schema, Model.SCHEMA)
  assert.equal(snapshot.doc.totals.unread, 17)
  assert.equal(snapshot.doc.channels.length, 4)
  assert.equal(snapshot.doc.work.overdue.length, 1)
})

test("a document from a newer sal is refused rather than half-drawn", () => {
  const newer = JSON.stringify(Object.assign({}, doc, { schema: 2 }))
  const snapshot = Model.parse(newer)
  assert.equal(snapshot.status, "unsupported")
  assert.equal(Model.state(snapshot, publishedAt, settings, true), "unsupported")
  assert.match(Model.fixFor("unsupported").run, /omarchy plugin update/)
})

test("a file caught mid-rename is a state, not an exception", () => {
  const snapshot = Model.parse('{"schema": 1, "totals"')
  assert.equal(snapshot.status, "unreadable")
  // Not "signin", which is what it used to say: a file that is there and will
  // not parse is not a missing session, and signing in again repairs nothing.
  // The rename makes this a frame long in practice — a write that ran out of
  // disk, or a hand-edited file, is where it stops being transient.
  assert.equal(Model.state(snapshot, publishedAt, settings, true), "unreadable")
  const view = Model.view(snapshot, publishedAt, settings, true)
  assert.match(view.detail, /did not parse/)
  assert.match(view.detail, /JSON|Unexpected|Expected/) // the parser's own words
  assert.match(view.fix.run, /sal watch --once/)
  assert.equal(view.badge, "")
  assert.equal(Model.rows(view).length, 1)
})

// ── the states ──────────────────────────────────────────────────────────

test("before the CLI lookup returns, the widget says it is checking rather than guessing", () => {
  // Found by running it: the lookup is an async process launch, so the first
  // frames after a shell start have no answer yet — and "install the CLI" is
  // the worst thing to guess, because it tells someone who already installed
  // it to go and install it.
  const view = Model.view(Model.missing(), publishedAt, settings, null)
  assert.equal(view.state, "probing")
  assert.equal(view.fix, null)
  assert.equal(view.badge, "")
  assert.match(view.detail, /Looking for/)
  assert.equal(Model.rows(view).length, 0)

  // undefined is the same not-yet-known, not a third meaning.
  assert.equal(Model.state(Model.missing(), publishedAt, settings, undefined), "probing")
})

test("a published document outranks the lookup — counts show before the probe returns", () => {
  assert.equal(Model.state(loaded(), publishedAt, settings, null), "ok")
})

test("no file and no CLI is setup, and setup has no button because there is nothing to press", () => {
  const view = Model.view(Model.missing(), publishedAt, settings, false)
  assert.equal(view.state, "setup")
  assert.equal(view.fix.run, "")
  assert.match(view.fix.hint, /sal login/)
  assert.equal(view.badge, "")
})

test("a CLI with no file is sign-in, and the button opens a terminal on sal login", () => {
  const view = Model.view(Model.missing(), publishedAt, settings, true)
  assert.equal(view.state, "signin")
  assert.match(view.fix.run, /sal login/)
})

test("a logged-out document is sign-in even while it is fresh", () => {
  const out = Model.parse(JSON.stringify(Object.assign({}, doc, { state: "logged-out" })))
  assert.equal(Model.state(out, publishedAt, settings, true), "signin")
})

test("sign-in outranks stale, because restarting a watcher with nothing to sign in with fixes nothing", () => {
  const out = Model.parse(JSON.stringify(Object.assign({}, doc, { state: "logged-out" })))
  const longAfter = publishedAt + 86400 * 1000
  assert.equal(Model.state(out, longAfter, settings, true), "signin")
})

test("past staleAfterSec the watcher is stopped, and the last counts stay on screen struck through", () => {
  const view = Model.view(loaded(), publishedAt + 121 * 1000, settings, true)
  assert.equal(view.state, "stopped")
  assert.equal(view.stale, true)
  // A bar that drops to zero when its feed dies has told you something false.
  assert.equal(view.badge, "17")
  assert.match(view.detail, /2m ago/)
  assert.match(view.fix.run, /sal watch --install-service/)
})

test("staleness follows the daemon's heartbeat, so the readers cannot disagree", () => {
  // Three missed beats — the same rule State.Stale uses in saltare-cli. They
  // briefly differed (90s there, a hardcoded 120s here), and a bar widget
  // reading "ok" beside a waybar module reading "stopped" is the seam leaking
  // into the user's face.
  assert.equal(Model.staleLimit(doc, {}), 3 * doc.heartbeat_sec)
  assert.equal(Model.state(loaded(), publishedAt + 89 * 1000, settings, true), "ok")
  assert.equal(Model.state(loaded(), publishedAt + 91 * 1000, settings, true), "stopped")
})

test("an explicit staleAfterSec overrides the heartbeat, for a machine that needs patience", () => {
  const patient = { staleAfterSec: 600 }
  assert.equal(Model.staleLimit(doc, patient), 600)
  assert.equal(Model.state(loaded(), publishedAt + 300 * 1000, patient, true), "ok")
})

test("a dropped socket is offline, and offline says which server and how old", () => {
  const dropped = Model.parse(JSON.stringify(Object.assign({}, doc, { live: false })))
  const view = Model.view(dropped, publishedAt + 60 * 1000, settings, true)
  assert.equal(view.state, "offline")
  assert.equal(view.badge, "17")
  assert.match(view.detail, /saltare\.ai/)
  assert.match(view.detail, /1m ago/)
})

test("offline outranks a mention, because last-known matters more than being called", () => {
  const dropped = Model.parse(JSON.stringify(Object.assign({}, doc, { live: false })))
  const view = Model.view(dropped, publishedAt, settings, true)
  assert.equal(view.state, "offline")
  assert.equal(view.urgent, true) // still urgent — just not the headline
})

test("fresh and live is ok, with no fix to offer", () => {
  const view = Model.view(loaded(), publishedAt + 1000, settings, true)
  assert.equal(view.state, "ok")
  assert.equal(view.fix, null)
  assert.equal(view.detail, "")
})

test("every state that is not ok names its own fix", () => {
  // Every state but "ok", which has nothing to fix, and "probing", which is
  // over before anyone could act on it.
  for (const name of ["setup", "signin", "stopped", "offline", "blocked",
                      "unsupported", "unreadable"]) {
    const fix = Model.fixFor(name)
    assert.ok(fix, name + " has no fix")
    assert.ok(fix.label.length > 0, name + " has no label")
    assert.ok(fix.run !== "" || fix.hint !== "", name + " offers neither a command nor an instruction")
  }
})

// ── the badge ───────────────────────────────────────────────────────────

test("the badge draws nothing at zero and stops counting past ninety-nine", () => {
  assert.equal(Model.badge(0), "")
  assert.equal(Model.badge(1), "1")
  assert.equal(Model.badge(99), "99")
  assert.equal(Model.badge(100), "99+")
  assert.equal(Model.badge(4821), "99+")
})

test("urgency is mentions, not unread", () => {
  assert.equal(Model.view(loaded(), publishedAt, settings, true).urgent, true)
  const quiet = Model.parse(JSON.stringify(Object.assign({}, doc, {
    totals: Object.assign({}, doc.totals, { mentions: 0 })
  })))
  assert.equal(Model.view(quiet, publishedAt, settings, true).urgent, false)
})

test("showWhenIdle off hides a widget with nothing to say, and never hides one with something", () => {
  const idle = Model.parse(JSON.stringify(Object.assign({}, doc, {
    totals: { unread: 0, mentions: 0, notifications: 0, overdue: 0, due_today: 0 },
    channels: []
  })))
  assert.equal(Model.view(idle, publishedAt, { showWhenIdle: false }, true).visible, false)
  assert.equal(Model.view(idle, publishedAt, { showWhenIdle: true }, true).visible, true)
  assert.equal(Model.view(loaded(), publishedAt, { showWhenIdle: false }, true).visible, true)

  // Each of the four counts on its own is enough to show it.
  for (const count of ["unread", "mentions", "overdue", "due_today"]) {
    const only = Model.parse(JSON.stringify(Object.assign({}, doc, {
      totals: Object.assign({ unread: 0, mentions: 0, notifications: 0, overdue: 0,
                              due_today: 0, mail: 0 }, { [count]: 1 }),
    })))
    assert.equal(Model.view(only, publishedAt, { showWhenIdle: false }, true).visible, true,
      count + " alone should show the widget")
  }

  // Mail is not one of them: nothing in the popup opens it, and an unread
  // message can sit in a mailbox for a month — which would leave the setting
  // meaning nothing at all.
  const mailOnly = Model.parse(JSON.stringify(Object.assign({}, doc, {
    totals: { unread: 0, mentions: 0, notifications: 0, overdue: 0, due_today: 0, mail: 4 },
  })))
  assert.equal(Model.view(mailOnly, publishedAt, { showWhenIdle: false }, true).visible, false)
  // A state that needs a human is never hidden, whatever the setting says.
  assert.equal(Model.view(Model.missing(), publishedAt, { showWhenIdle: false }, false).visible, true)
})

// ── the lists ───────────────────────────────────────────────────────────

test("caps are visible: totals disagree with the list and the widget says by how much", () => {
  const capped = Model.parse(JSON.stringify(Object.assign({}, doc, {
    totals: Object.assign({}, doc.totals, { unread: 40, notifications: 9 })
  })))
  const view = Model.view(capped, publishedAt, settings, true)
  assert.equal(view.moreUnread, 40 - 17)
  assert.equal(view.moreNotifications, 8)
})

test("a document missing half its shape draws nothing rather than throwing", () => {
  // The fixture is byte-identical to the daemon's golden, so today these
  // cannot happen. The two repos release separately, and the place this would
  // land is inside a bar, where a TypeError is a widget that stops painting
  // with no error anyone will see. `[].concat(undefined)` is `[undefined]`,
  // and the line after it read .title off it.
  const partial = Model.parse(JSON.stringify(Object.assign({}, doc, {
    work: { overdue: [{ slug: "a", title: "A", due_date: "2026-09-14" }] }, // no today
    channels: [null, { slug: "b", title: "b", kind: "public_channel", unread: 2 }],
    notifications: null,
    mail: "not a list",
  })))
  const view = Model.view(partial, publishedAt, settings, true)
  assert.equal(view.state, "ok")
  assert.deepEqual(view.work.today, [])
  assert.equal(view.channels.length, 1)
  assert.deepEqual(view.notifications, [])
  assert.deepEqual(view.mail, [])
  const rows = Model.rows(view)
  assert.deepEqual(rows.map((r) => r.kind), ["channel", "task"])
  assert.equal(rows[1].label, "A")
})

test("the sigil goes back on here, because the daemon sends a bare title on purpose", () => {
  // The kinds are the server's enum, not a guess. Guessing produced
  // "#DevOps Monitor" in a live bar: agent DMs are `agent_dm`, never `dm`.
  assert.equal(Model.channelLabel({ kind: "public_channel", title: "general" }), "#general")
  assert.equal(Model.channelLabel({ kind: "private_channel", title: "secret" }), "#secret")
  assert.equal(Model.channelLabel({ kind: "thread", title: "Q3 launch" }), "↳ Q3 launch")
  assert.equal(Model.channelLabel({ kind: "discussion", title: "Fix the deploy" }), "↳ Fix the deploy")

  // Prefixing a name with "#" would be a lie about what it is.
  assert.equal(Model.channelLabel({ kind: "dm", title: "Alice Chen" }), "Alice Chen")
  assert.equal(Model.channelLabel({ kind: "agent_dm", title: "DevOps Monitor" }), "DevOps Monitor")
  assert.equal(Model.channelLabel({ kind: "agent_collaboration", title: "Squad" }), "Squad")

  // A kind this plugin has never heard of is safer bare than wrong.
  assert.equal(Model.channelLabel({ kind: "something_new", title: "Whatever" }), "Whatever")
})

test("a notification reads the way the web app's own does", () => {
  assert.equal(
    Model.notificationLine(doc.notifications[0]),
    "Alice Chen mentioned you in #general"
  )
  assert.equal(Model.notificationLine({}), "Saltare")
})

test("age rounds the way a person would say it", () => {
  const stamp = { updated_at: doc.updated_at }
  assert.equal(Model.agoLabel(stamp, publishedAt + 30 * 1000), "just now")
  assert.equal(Model.agoLabel(stamp, publishedAt + 300 * 1000), "5m ago")
  assert.equal(Model.agoLabel(stamp, publishedAt + 3 * 3600 * 1000), "3h ago")
  assert.equal(Model.agoLabel(stamp, publishedAt + 50 * 3600 * 1000), "2d ago")
  assert.equal(Model.agoLabel({ updated_at: "nonsense" }, publishedAt), "at some point")
})

// ── actions ─────────────────────────────────────────────────────────────

test("rows act through the CLI that holds the session, never through a request", () => {
  assert.equal(Model.openCommand("channel", "general"), "sal open channel 'general'")
  assert.equal(Model.completeCommand("fix-deploy"), "sal tasks complete 'fix-deploy'")
  assert.equal(Model.openCommand("channel", ""), "")
})

test("slugs off the wire are quoted, because tame in practice is how injection gets written", () => {
  assert.equal(Model.shellQuote("it's"), "'it'\\''s'")
  const hostile = Model.openCommand("channel", "x'; rm -rf ~; echo '")
  assert.ok(!hostile.includes("; rm -rf ~;") || hostile.includes("'\\''"),
    "the payload must not survive as shell syntax")
  assert.equal(hostile, "sal open channel 'x'\\''; rm -rf ~; echo '\\'''")
})

// ── the path ────────────────────────────────────────────────────────────

test("statePath resolves the way the daemon does", () => {
  assert.equal(Model.statePath("", "/run/state", "/home/jack"), "/run/state/saltare/watch.json")
  assert.equal(Model.statePath("", "", "/home/jack"), "/home/jack/.local/state/saltare/watch.json")
  assert.equal(Model.statePath("/tmp/w.json", "/run/state", "/home/jack"), "/tmp/w.json")
  // Someone typing a path into a settings field will type a tilde.
  assert.equal(Model.statePath("~/w.json", "", "/home/jack"), "/home/jack/w.json")
})

// ── navigation ──────────────────────────────────────────────────────────

test("the popup is one flat list, labelled by section", () => {
  const view = Model.view(loaded(), publishedAt, settings, true)
  const rows = Model.rows(view)

  assert.deepEqual(rows.map((r) => r.kind), [
    "notification", "channel", "channel", "channel", "channel", "task", "task"
  ])
  assert.deepEqual(
    rows.filter((r) => r.section !== "").map((r) => r.section),
    ["MENTIONS", "UNREAD", "WORK"]
  )
  // Only the first row of a run carries the heading, so navigation never has
  // to skip a row that isn't a row.
  assert.equal(rows[2].section, "")
})

test("every row knows the command its enter key runs", () => {
  const rows = Model.rows(Model.view(loaded(), publishedAt, settings, true))
  for (const row of rows) {
    assert.ok(row.command.startsWith("sal "), row.kind + " has no command")
  }
  assert.equal(rows[1].command, "sal open channel 'engineering'")
  assert.equal(rows[5].command, "sal open task 'fix-deploy'")
  assert.equal(rows[5].complete, "sal tasks complete 'fix-deploy'")
})

test("overdue work is marked urgent and today's is not", () => {
  const rows = Model.rows(Model.view(loaded(), publishedAt, settings, true))
  const tasks = rows.filter((r) => r.kind === "task")
  assert.equal(tasks[0].urgent, true)
  assert.equal(tasks[1].urgent, false)
})

test("a state that needs a human offers its fix and nothing else to get lost in", () => {
  const rows = Model.rows(Model.view(Model.missing(), publishedAt, settings, true))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, "fix")
  assert.match(rows[0].command, /sal login/)

  // Setup has no runnable fix, so it has no rows at all — the panel shows the
  // instruction as text rather than a button that cannot work.
  assert.equal(Model.rows(Model.view(Model.missing(), publishedAt, settings, false)).length, 0)
})

test("a stopped watcher still lists what it last knew, with the restart at the end", () => {
  const rows = Model.rows(Model.view(loaded(), publishedAt + 200 * 1000, settings, true))
  assert.ok(rows.length > 1)
  assert.equal(rows[rows.length - 1].kind, "fix")
  assert.match(rows[rows.length - 1].command, /--install-service/)
})

// ── the QML, held to the two claims the README makes about it ───────────
//
// There is no QML test harness in the shell, so these read the source. That is
// weaker than running it, and it is strong enough for the two properties that
// would be quietly lost in a refactor.

const qml = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8")

test("the data layer watches a file and nothing else — no socket, no token, no request", () => {
  const source = qml("Watch.qml")
  assert.match(source, /FileView\s*{/)
  assert.match(source, /watchChanges:\s*true/)
  // The daemon renames its temp file into place; without the reload the view
  // goes deaf after the first publish.
  assert.match(source, /onFileChanged:\s*reload\(\)/)

  for (const forbidden of ["XMLHttpRequest", "WebSocket", "access_token", "Authorization", "https://"]) {
    assert.ok(!source.includes(forbidden),
      "Watch.qml must not " + forbidden + " — sal holds the session")
  }
})

test("the file appearing for the first time is the change inotify cannot report", () => {
  const source = qml("Watch.qml")
  // $XDG_STATE_HOME/saltare/ does not exist until `sal watch` first runs, and
  // a watcher cannot watch a directory that is not there. Confirmed against a
  // live Quickshell: a file created in an existing directory is seen, and one
  // whose directory arrives with it is not, ever.
  assert.match(source, /running:\s*root\.snapshot\.status\s*!==\s*"loaded"/)
  assert.match(source, /onTriggered:\s*file\.reload\(\)/)
})

test("nothing in the plugin carries a credential or calls the API directly", () => {
  for (const name of ["Watch.qml", "Panel.qml", "Model.js"]) {
    const source = qml(name)
    for (const forbidden of ["XMLHttpRequest", "WebSocket", "/api/v1", "access_token"]) {
      assert.ok(!source.includes(forbidden), name + " must not reference " + forbidden)
    }
  }
})

test("the widget wears the user's theme, not Saltare's", () => {
  const source = qml("Panel.qml")
  // A bar widget that paints itself in its own brand inside someone else's
  // palette is the one they uninstall in a week.
  const hardcoded = source.match(/"#[0-9a-fA-F]{3,8}"/g)
  assert.equal(hardcoded, null, "hardcoded colours: " + hardcoded)
  assert.match(source, /bar\.foreground/)
  assert.match(source, /Color\./)
  assert.match(source, /Style\.font/)
})

test("every action the panel takes goes through a command the model built", () => {
  const source = qml("Panel.qml")
  assert.match(source, /rows\[cursor\]\.command/)
  assert.match(source, /row\.complete/)
  // No shell strings assembled in QML — that is what Model.shellQuote is for.
  assert.ok(!/"sal (open|send|tasks) [^"]*" \+/.test(source),
    "Panel.qml is building a command by hand instead of asking Model.js")
})

// The host's key catcher spends some letters on named signals and returns
// before it emits textKey, so a plugin that waits for those letters as text
// waits forever. `x` did: the README, the footer and completeSelected() all
// agreed on a key that never arrived. Read the contract rather than restate it,
// so the next letter Omarchy promotes fails here instead of in someone's bar.
const catcherPath = path.join(
  process.env.OMARCHY_PATH || "/usr/share/omarchy", "shell", "Ui", "PanelKeyCatcher.qml")

// The body of `onFoo: function(...) { ... }`, brace-matched.
function handlerBody(source, name) {
  const at = source.indexOf(name + ":")
  if (at === -1) return ""
  const open = source.indexOf("{", at)
  if (open === -1) return ""
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i)
  }
  return ""
}

test("no key we wait for as text is one the host already spent on a signal", (t) => {
  if (!fs.existsSync(catcherPath)) return t.skip("Omarchy is not installed here")
  const catcher = fs.readFileSync(catcherPath, "utf8")
  // From the key handler itself, not the signal declaration above it, down to
  // the one emit that anything unclaimed falls through to.
  const pressed = catcher.slice(catcher.indexOf("Keys.onPressed"))
  const beforeTextKey = pressed.slice(0, pressed.indexOf("textKey("))
  const spent = new Set(
    [...beforeTextKey.matchAll(/event\.text\s*===\s*"(.)"/g)].map((m) => m[1].toLowerCase()))
  assert.ok(spent.size > 0, "read no spent keys out of " + catcherPath)

  const body = handlerBody(qml("Panel.qml"), "onTextKey")
  assert.ok(body !== "", "found no onTextKey handler in Panel.qml")
  for (const key of spent) {
    assert.ok(!new RegExp('"' + key + '"', "i").test(body),
      "Panel.qml waits for \"" + key + "\" in onTextKey, but PanelKeyCatcher spends it on a "
      + "named signal first — it will never arrive")
  }
})

test("x completes a task through the signal the host actually emits", () => {
  const source = qml("Panel.qml")
  assert.match(source, /onDeleteRequested:[^\n]*completeSelected\(\)/)
  // The footer promises it, so the wiring above is what makes the promise true.
  assert.match(source, /x complete/)
})

test("the manifest declares what the shell needs and what the settings pane shows", () => {
  const manifest = JSON.parse(qml("manifest.json"))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.id, "saltare.workspace")
  // The overlay joined later; the widget is what this file is about.
  assert.ok(manifest.kinds.includes("bar-widget"))
  assert.equal(manifest.entryPoints.barWidget, "Panel.qml")
  assert.ok(fs.existsSync(path.join(__dirname, "..", manifest.entryPoints.barWidget)))

  // Every setting the model reads must be reachable from the settings pane, or
  // it is a knob nobody can turn.
  const keys = manifest.barWidget.schema.map((entry) => entry.key)
  for (const key of ["statePath", "showWhenIdle", "staleAfterSec"]) {
    assert.ok(keys.includes(key), "no settings entry for " + key)
  }
})

test("a server that answered and refused is blocked, not offline", () => {
  // The first live run of the daemon hit a workspace at its monthly request
  // cap. The connection was perfect; the widget would have blamed it.
  const refused = Model.parse(JSON.stringify(Object.assign({}, doc, {
    state: "blocked",
    live: false,
    error: "Monthly API request limit reached (0). Upgrade your plan for more requests."
  })))
  const view = Model.view(refused, publishedAt, settings, true)

  assert.equal(view.state, "blocked")
  assert.match(view.detail, /Monthly API request limit/)
  assert.ok(!/Can't reach/.test(view.detail))
  // No retry and no re-login fixes a plan limit, so neither is offered.
  assert.ok(!/watch --once|sal login/.test(view.fix.run))
  assert.match(view.fix.run, /sal doctor/)
  // The counts it last knew are still worth showing.
  assert.equal(view.badge, "17")
})

test("blocked is not dimmed, because the numbers on screen are still real", () => {
  const refused = Model.parse(JSON.stringify(Object.assign({}, doc, { state: "blocked", live: false })))
  assert.equal(Model.view(refused, publishedAt, settings, true).dim, false)
})

test("every demo state renders as bin/demo-states advertises it", () => {
  // The tool is how a person walks the states before shipping a change, so its
  // claims are checked here rather than trusted. A demo that quietly stopped
  // producing the state it names would be worse than no demo.
  const { execFileSync } = require("node:child_process")
  const os = require("node:os")
  const tmp = path.join(os.tmpdir(), "saltare-demo-test.json")
  const tool = path.join(__dirname, "..", "bin", "demo-states")

  const expected = {
    ok: "ok", "no-mail": "ok", quiet: "ok", offline: "offline", blocked: "blocked",
    stopped: "stopped", signin: "signin", unsupported: "unsupported",
    unreadable: "unreadable",
  }

  // --list is the tool's own inventory. A state added there and forgotten here
  // is a state nobody walks, which is the failure the tool exists to prevent.
  const listed = execFileSync(tool, ["--list"], { encoding: "utf8" })
    .split("\n").map((line) => line.trim().split(/\s+/)[0]).filter(Boolean)
  assert.ok(listed.length > 0, "bin/demo-states --list said nothing")
  for (const name of listed) {
    assert.ok(name in expected, `bin/demo-states lists "${name}" and nothing here checks it`)
  }

  for (const [name, wanted] of Object.entries(expected)) {
    execFileSync(tool, ["--write", name, "--path", tmp], { stdio: "ignore" })
    const view = Model.view(Model.parse(fs.readFileSync(tmp, "utf8")), Date.now(), {}, true)
    assert.equal(view.state, wanted, `demo state "${name}" rendered as "${view.state}"`)
  }

  // And the two that carry counts through a failure really do keep them.
  for (const name of ["offline", "blocked", "stopped"]) {
    execFileSync(tool, ["--write", name, "--path", tmp], { stdio: "ignore" })
    const view = Model.view(Model.parse(fs.readFileSync(tmp, "utf8")), Date.now(), {}, true)
    assert.equal(view.badge, "13", `${name} should keep its last known counts`)
  }
  fs.rmSync(tmp, { force: true })
})

test("the bar widget root has an implicit size, or the bar gives it no room", () => {
  // Found by looking at a bar that had no widget on it. The component loaded,
  // the layout listed it, the log was clean — and the root Item was 0x0, so
  // the BarIconButton anchored to fill it filled nothing. Nothing errors; it
  // is simply absent, which is the hardest kind of broken to notice.
  const source = qml("Panel.qml")
  assert.match(source, /implicitWidth:\s*button\./)
  assert.match(source, /implicitHeight:\s*button\./)
  // And it must collapse when hidden, or showWhenIdle:false leaves a gap.
  assert.match(source, /implicitWidth:\s*button\.visible\s*\?/)
})

test("the mail count reaches the view, counted from the inbox the daemon picked", () => {
  const view = Model.view(loaded(), publishedAt, settings, true)
  // The golden has three unread in Trash and two in the inbox. Two is the
  // answer; a reader that summed folders would say five.
  assert.equal(view.totals.mail, 2)
  assert.equal(view.mail.length, 1)
  assert.equal(view.mail[0].name, "Ada Lovelace")
})

test("mail adds no rows, because a row that opens nothing is a door painted on a wall", () => {
  // Every row in this popup runs a command. There is no desktop mail client to
  // open one in and no web mailbox on the server, so mail stays a count in the
  // summary line rather than becoming the one section you cannot act on.
  const view = Model.view(loaded(), publishedAt, settings, true)
  const headings = Model.rows(view).map((r) => r.section).filter((s) => s !== "")
  assert.deepEqual(headings, ["MENTIONS", "UNREAD", "WORK"])
})

test("a session that cannot see mail is not a session with an empty inbox", () => {
  // The daemon sends null, not [], for a reader without mail:read. Neither
  // draws anything, but the document keeps the two apart.
  const doc = JSON.parse(fixture)
  doc.mail = null
  doc.totals.mail = 0
  const view = Model.view(Model.parse(JSON.stringify(doc)), publishedAt, settings, true)
  assert.deepEqual(view.mail, [])
  assert.equal(view.totals.mail, 0)
})

test("the mail line names the account, which is the part a bare number cannot", () => {
  const view = Model.view(loaded(), publishedAt, settings, true)
  assert.equal(view.mailLine, "2 unread mail in Ada Lovelace")
})

test("two accounts are counted, not listed", () => {
  const line = Model.mailLine({ mail: 7 }, [
    { name: "Ada Lovelace", unread: 4 },
    { name: "Work", unread: 3 },
    { name: "Quiet", unread: 0 }
  ])
  assert.equal(line, "7 unread mail across 2 accounts")
})

test("a total with no list behind it still says the number", () => {
  // The daemon caps the list at five mailboxes but keeps the total exact, so
  // the two can legitimately disagree.
  assert.equal(Model.mailLine({ mail: 3 }, []), "3 unread mail")
})

test("no mail is no line at all", () => {
  assert.equal(Model.mailLine({ mail: 0 }, []), "")
  assert.equal(Model.mailLine({}, []), "")
  assert.equal(Model.view(Model.missing(), publishedAt, settings, true).mailLine, "")
})

test("the panel gives mail its own line, because the hero elides", () => {
  // Four counts already clip "1 due today" to "1 due toda\u2026" at this width. A
  // fifth would be written and never read.
  const source = fs.readFileSync(path.join(__dirname, "..", "Panel.qml"), "utf8")
  assert.match(source, /text: root\.view\.mailLine/)
  assert.ok(!/summaryLine[\s\S]*totals\.mail/.test(source),
    "the hero summary must not carry a count it will elide")
})
