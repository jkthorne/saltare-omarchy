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
  const routed = Capture.route("?the receipt from March")
  assert.equal(routed.kind, "search")
  assert.equal(routed.target, "the receipt from March")
  assert.equal(routed.command, "sal search 'the receipt from March'")
  assert.equal(routed.summary, "Search for the receipt from March")
})

test("a search answers in the overlay, because the results are the point", () => {
  assert.equal(Capture.streams(Capture.route("?deploy")), true)
})

test("anything without a sigil is a question, because that is the common case", () => {
  const routed = Capture.route("what broke the deploy last night")
  assert.equal(routed.kind, "ask")
  assert.equal(routed.command, "sal ask 'what broke the deploy last night'")
  assert.equal(Capture.streams(routed), true)
})

test("only the two questions stream back; every send gets out of the way", () => {
  for (const input of ["#general hi", "@scout hi", "!a thing", "/doc a doc"]) {
    assert.equal(Capture.streams(Capture.route(input)), false, input)
  }
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
