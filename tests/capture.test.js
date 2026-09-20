const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const Capture = require("../Capture.js")

test("#channel posts a message", () => {
  const routed = Capture.route("#general ship it")
  assert.equal(routed.kind, "send")
  assert.equal(routed.target, "general")
  assert.equal(routed.command, "sal send 'general' 'ship it'")
  assert.equal(routed.summary, "Send to #general")
})

test("@agent messages an agent's DM", () => {
  const routed = Capture.route("@researcher what changed in Q3?")
  assert.equal(routed.kind, "agent")
  assert.equal(routed.command, "sal agents message 'researcher' 'what changed in Q3?'")
})

test("/doc starts a document", () => {
  const routed = Capture.route("/doc Q3 launch notes")
  assert.equal(routed.kind, "doc")
  assert.equal(routed.command, "sal docs new 'Q3 launch notes'")
})

test("! files a task, with or without a space after the bang", () => {
  for (const input of ["! fix the deploy", "!fix the deploy"]) {
    const routed = Capture.route(input)
    assert.equal(routed.kind, "task", input)
    assert.equal(routed.command, "sal tasks add 'fix the deploy'", input)
    assert.equal(routed.due, "")
  }
})

test("a leading ISO date on a task is its due date, spaced or not", () => {
  // A grammar that cares about a space is a grammar you get wrong at speed.
  for (const input of ["!2026-09-20 ship the plugin", "! 2026-09-20 ship the plugin"]) {
    const routed = Capture.route(input)
    assert.equal(routed.due, "2026-09-20", input)
    assert.equal(routed.command, "sal tasks add 'ship the plugin' --due '2026-09-20'", input)
    assert.equal(routed.summary, "New task, due 2026-09-20")
  }
})

test("something that only looks like a date stays in the title", () => {
  const routed = Capture.route("!2026 planning")
  assert.equal(routed.due, "")
  assert.equal(routed.command, "sal tasks add '2026 planning'")
})

test("?query searches every pull surface at once", () => {
  // Every one of them, which was not true when this test was named: the
  // command is unchanged and `sal search` grew the workspace directory, so a
  // colleague is now findable from the field that had no route to one.
  const routed = Capture.route("?the receipt from March")
  assert.equal(routed.kind, "search")
  assert.equal(routed.target, "the receipt from March")
  // --json leads the query: parseTrailing in the CLI refuses a trailing
  // valueless flag, because it would be swallowed as a word of the query.
  assert.equal(routed.command, "sal search --json 'the receipt from March'")
  assert.equal(routed.summary, "Search for the receipt from March")
})

test("both questions answer in the overlay; they no longer answer the same way", () => {
  // An answer is prose and arrives a line at a time, so it streams into a
  // pane. A search is a list of things you might open, so it arrives whole and
  // becomes rows. Calling both "streams" was true of the plumbing and false of
  // the product — it is what left the results unreachable for a keyboard.
  assert.equal(Capture.streams(Capture.route("?deploy")), false)
  assert.equal(Capture.finds(Capture.route("?deploy")), true)
  assert.equal(Capture.streams(Capture.route("why")), true)
  assert.equal(Capture.finds(Capture.route("why")), false)
})

test("anything without a sigil is a question, because that is the common case", () => {
  const routed = Capture.route("what broke the deploy last night")
  assert.equal(routed.kind, "ask")
  assert.equal(routed.command, "sal ask 'what broke the deploy last night'")
  assert.equal(Capture.streams(routed), true)
})

test("every send gets out of the way — nothing to stream and nothing to list", () => {
  for (const input of ["#general hi", "@scout hi", "!a thing", "/doc a doc"]) {
    assert.equal(Capture.streams(Capture.route(input)), false, input)
    assert.equal(Capture.finds(Capture.route(input)), false, input)
  }
})

// ── the rows a search becomes ───────────────────────────────────────────

const searchJSON = JSON.stringify({
  messages: [{ id: 7, body: "the zeppelin\ndeploy finished", channel: { slug: "general" } }],
  tasks: [{ slug: "fix-deploy", title: "Fix the deploy", state: "open" }],
  documents: [
    { slug: "notes", title: "Notes", path: "airship-logs/notes" },
    { slug: "daily", title: "Daily" },
  ],
  uploads: [{ slug: "plan", title: "plan.pdf" }],
  people: [{ id: 351812532, name: "Alice Chen", title: "Staff Eng", email: "a@x.com" }],
})

test("every row knows the command its enter key runs", () => {
  // The invariant the bar widget's popup has always held, and the one this
  // surface did not: it rendered results as a block of text nothing could
  // select, click or reach with a key.
  const rows = Capture.rows(searchJSON)
  assert.equal(rows.length, 6)
  for (const row of rows) {
    assert.ok(row.command !== "", JSON.stringify(row))
    assert.ok(row.label !== "", JSON.stringify(row))
  }
  assert.deepEqual(rows.map((r) => r.kind), ["msg", "task", "doc", "doc", "file", "person"])
})

test("a document opens at its tree address, or at its own editor when it has none", () => {
  // Everything /doc has ever created has no node, so the fallback is the
  // common case rather than the exception.
  const [withPath, withoutPath] = Capture.rows(searchJSON).filter((r) => r.kind === "doc")
  assert.equal(withPath.command, "sal open data 'airship-logs/notes'")
  assert.equal(withoutPath.command, "sal open document 'daily'")
})

test("a person is opened by membership id, and a message by its channel and id", () => {
  const rows = Capture.rows(searchJSON)
  assert.equal(rows.find((r) => r.kind === "person").command, "sal open member 351812532")
  assert.equal(rows.find((r) => r.kind === "msg").command, "sal open message 'general' 7")
})

test("a body with a newline in it is still one row", () => {
  assert.equal(Capture.rows(searchJSON)[0].label, "the zeppelin deploy finished")
})

test("a hit with nothing to open is not drawn at all", () => {
  // Better an absent row than one that looks like every other row and does
  // nothing when you press enter.
  const rows = Capture.rows(JSON.stringify({
    tasks: [{ title: "No slug, no URL" }, { slug: "ok", title: "Fine" }],
  }))
  assert.deepEqual(rows.map((r) => r.label), ["Fine"])
})

test("output that is not a search result is no rows, not an exception", () => {
  for (const junk of ["", "   ", "no results", "{", "null", "[1,2]", undefined]) {
    assert.deepEqual(Capture.rows(junk), [], JSON.stringify(junk))
  }
})

test("everything a row runs was quoted by the same function every send uses", () => {
  const rows = Capture.rows(JSON.stringify({
    documents: [{ slug: "it's; rm -rf ~", title: "Hostile" }],
  }))
  assert.equal(rows[0].command, "sal open document 'it'\\''s; rm -rf ~'")
})

test("a sigil with nothing after it is not an action", () => {
  for (const input of ["", "   ", "#general", "#general   ", "@scout", "!", "!   ", "/doc", "?", "?  "]) {
    assert.equal(Capture.route(input), null, JSON.stringify(input))
  }
})

test("a bare # or @ is text, not a broken sigil", () => {
  assert.equal(Capture.route("#").kind, "ask")
  assert.equal(Capture.route("@").kind, "ask")
})

test("everything that reaches a shell is quoted", () => {
  const routed = Capture.route("#general '; rm -rf ~; echo '")
  assert.equal(routed.command, "sal send 'general' ''\\''; rm -rf ~; echo '\\'''")

  const asked = Capture.route("what about $(whoami) and `id`?")
  assert.ok(asked.command.startsWith("sal ask '"))
  assert.ok(asked.command.endsWith("'"))
  // Inside single quotes nothing expands; the only escape that matters is the
  // quote itself, and there isn't one here.
  assert.ok(!asked.command.includes("'\\''"))
})

test("the hint teaches the grammar it implements", () => {
  const hint = Capture.hint()
  for (const sigil of ["#", "@", "!", "/doc", "?"]) {
    assert.ok(hint.includes(sigil), "hint omits " + sigil)
  }
})

test("the overlay holds no session and issues no request", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "Capture.qml"), "utf8")
  for (const forbidden of ["XMLHttpRequest", "WebSocket", "/api/v1", "access_token"]) {
    assert.ok(!source.includes(forbidden), "Capture.qml must not reference " + forbidden)
  }
  // And it builds no command by hand — Capture.js is the only place that does.
  // Named subcommands only: "sal exited 3" is an error message, not an argv.
  assert.ok(!/"sal (send|ask|search|tasks|docs|agents|open|status|watch)\b/.test(source),
    "Capture.qml is assembling a command instead of asking Capture.js")
})

test("a search that found nothing is not an error", () => {
  // `sal search` says "no results" on stderr and exits 0. The overlay has to
  // read the exit code before it decides that red is the right colour.
  const source = fs.readFileSync(path.join(__dirname, "..", "Capture.qml"), "utf8")
  assert.match(source, /stderr: SplitParser \{ onRead: function\(line\) \{ root\.streamNotice/)
  assert.match(source, /if \(exitCode === 0\) root\.say\(root\.streamNotice\)/)
})

test("the overlay answers the shell's summon contract", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "Capture.qml"), "utf8")
  // The shell summons an overlay by calling open()/close() on whatever the
  // entry point loads, so the root has to be an Item that has them — not the
  // window itself.
  assert.match(source, /function open\(/)
  assert.match(source, /function close\(/)
  assert.match(source, /PanelWindow \{/)
  assert.match(source, /visible: root\.opened/)
  assert.match(source, /WlrKeyboardFocus\.Exclusive/)
})

test("ctrl+c stops a stream, and the rest of the time it copies", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "Capture.qml"), "utf8")
  // Accepting it unconditionally meant the one key that copies never reached
  // a field whose whole job is what you typed into it.
  assert.match(source, /Qt\.Key_C[\s\S]{0,200}root\.asking/)
})

test("one command in flight at a time, and the line under the field says which", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "Capture.qml"), "utf8")
  // A running Process ignores a new command and ignores running = true, so a
  // second enter was silently nothing — and on a streaming route it blanked
  // the pane first.
  assert.match(source, /if \(!action \|\| root\.busy\) return/)
  // Every process the overlay can have in flight counts, or the guard only
  // covers the ones it happened to know about when it was written.
  const busy = source.match(/readonly property bool busy:[^\n]*/)[0]
  for (const inFlight of ["asking", "searching", "runProcess.running"]) {
    assert.ok(busy.includes(inFlight), inFlight + " is not in: " + busy)
  }
  assert.match(source, /"sending…"/)
  assert.match(source, /"searching…"/)
})

test("the results are rows a keyboard can reach, not a pane it cannot", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "Capture.qml"), "utf8")
  assert.match(source, /ListView \{/)
  assert.match(source, /model: root\.rows/)
  // Selection on the root, not the view: the model is replaced wholesale on
  // every search and a view's own currentIndex would not survive it.
  assert.match(source, /hasCursor: root\.cursorActive && index === root\.selectedIndex/)
  // The field owns the keyboard and hands the arrows down; the view must not
  // fight it for them.
  assert.match(source, /keyNavigationEnabled: false/)
  assert.match(source, /Qt\.Key_Down/)
  assert.match(source, /Qt\.Key_Up/)
})

test("a row's command is spawned after the overlay has let go of the keyboard", () => {
  // The layer surface holds an exclusive grab; the browser about to open wants
  // it. Every host overlay dismisses first for this reason.
  const source = fs.readFileSync(path.join(__dirname, "..", "Capture.qml"), "utf8")
  const activate = source.match(/function activate\(\)[\s\S]*?\n  \}/)[0]
  assert.ok(activate.indexOf("dismiss()") < activate.indexOf("launcher.exec"),
    "activate() spawns before it dismisses:\n" + activate)
})

test("the overlay releases the summon it was given, and has to name itself to", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "Capture.qml"), "utf8")
  // The shell's scoped API refuses a target the plugin does not own, and ""
  // is owned by nobody. hide() with no argument returned false, so the window
  // went and the host went on believing the plugin was open.
  assert.match(source, /shell\.hide\(root\.pluginId\)/)
  assert.match(source, /pluginId:[^\n]*manifest\.id/)
})

test("a field summoned by a keystroke is not rebuilt on every keystroke", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"))
  // Without this the host drops the Loader on hide and recompiles the overlay
  // asynchronously on the next summon. Every keystroke-summoned overlay the
  // shell ships — emojis, clipboard, menu — sets it.
  assert.equal(manifest.keepLoaded, true)
})

test("the overlay is declared in the manifest, or nothing can summon it", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"))
  assert.ok(manifest.kinds.includes("overlay"))
  assert.equal(manifest.entryPoints.overlay, "Capture.qml")
  assert.ok(fs.existsSync(path.join(__dirname, "..", manifest.entryPoints.overlay)))
})
