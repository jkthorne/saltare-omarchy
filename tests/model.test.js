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
const settings = { staleAfterSec: 120, showWhenIdle: true }

function loaded() {
  return Model.parse(fixture)
}

// ── the seam ────────────────────────────────────────────────────────────

test("the golden document parses and carries the shape the widget draws", () => {
  const snapshot = loaded()
  assert.equal(snapshot.status, "loaded")
  assert.equal(snapshot.doc.schema, Model.SCHEMA)
  assert.equal(snapshot.doc.totals.unread, 13)
  assert.equal(snapshot.doc.channels.length, 3)
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
  assert.equal(Model.state(snapshot, publishedAt, settings, true), "signin")
})

// ── the five states ─────────────────────────────────────────────────────

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
  assert.equal(view.badge, "13")
  assert.match(view.detail, /2m ago/)
  assert.match(view.fix.run, /sal watch --install-service/)
})

test("the staleness boundary moves with the clock alone", () => {
  assert.equal(Model.state(loaded(), publishedAt + 119 * 1000, settings, true), "ok")
  assert.equal(Model.state(loaded(), publishedAt + 121 * 1000, settings, true), "stopped")
})

test("staleAfterSec is honoured, so a slow machine can stop being called dead", () => {
  const patient = { staleAfterSec: 600 }
  assert.equal(Model.state(loaded(), publishedAt + 300 * 1000, patient, true), "ok")
})

test("a dropped socket is offline, and offline says which server and how old", () => {
  const dropped = Model.parse(JSON.stringify(Object.assign({}, doc, { live: false })))
  const view = Model.view(dropped, publishedAt + 60 * 1000, settings, true)
  assert.equal(view.state, "offline")
  assert.equal(view.badge, "13")
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
  for (const name of ["setup", "signin", "stopped", "offline", "unsupported"]) {
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
  // A state that needs a human is never hidden, whatever the setting says.
  assert.equal(Model.view(Model.missing(), publishedAt, { showWhenIdle: false }, false).visible, true)
})

// ── the lists ───────────────────────────────────────────────────────────

test("caps are visible: totals disagree with the list and the widget says by how much", () => {
  const capped = Model.parse(JSON.stringify(Object.assign({}, doc, {
    totals: Object.assign({}, doc.totals, { unread: 40, notifications: 9 })
  })))
  const view = Model.view(capped, publishedAt, settings, true)
  assert.equal(view.moreUnread, 40 - 13)
  assert.equal(view.moreNotifications, 8)
})

test("the sigil goes back on here, because the daemon sends a bare title on purpose", () => {
  assert.equal(Model.channelLabel({ kind: "channel", title: "general" }), "#general")
  // Prefixing a person's name with "#" would be a lie about what it is.
  assert.equal(Model.channelLabel({ kind: "dm", title: "Alice Chen" }), "Alice Chen")
  assert.equal(Model.channelLabel({ kind: "thread", title: "Q3 launch" }), "↳ Q3 launch")
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
    "notification", "channel", "channel", "channel", "task", "task"
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
  assert.equal(rows[4].command, "sal open task 'fix-deploy'")
  assert.equal(rows[4].complete, "sal tasks complete 'fix-deploy'")
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

test("the manifest declares what the shell needs and what the settings pane shows", () => {
  const manifest = JSON.parse(qml("manifest.json"))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.id, "saltare.workspace")
  assert.deepEqual(manifest.kinds, ["bar-widget"])
  assert.equal(manifest.entryPoints.barWidget, "Panel.qml")
  assert.ok(fs.existsSync(path.join(__dirname, "..", manifest.entryPoints.barWidget)))

  // Every setting the model reads must be reachable from the settings pane, or
  // it is a knob nobody can turn.
  const keys = manifest.barWidget.schema.map((entry) => entry.key)
  for (const key of ["statePath", "showWhenIdle", "staleAfterSec"]) {
    assert.ok(keys.includes(key), "no settings entry for " + key)
  }
})
