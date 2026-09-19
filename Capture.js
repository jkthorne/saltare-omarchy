// Capture.js — the grammar of the capture field.
//
// One text field decides where what you typed goes. That idea is the same one
// saltareOS' launcher and saltare-ios' command surface are built on; this is
// its desktop reading. The routing is the whole product, so it lives here as
// pure functions and the overlay is a box that calls them.
//
// Everything routes to a `sal` argv. The overlay holds no session and makes no
// requests, exactly like the bar widget beside it.

var Model = (typeof require !== "undefined") ? require("./Model.js") : null

// quote is Model.shellQuote when required, and a copy when loaded into QML
// where Model.js is a separate `.import`. Keeping one definition and reaching
// for it is better than two that can disagree about a quote character.
function quote(value) {
  if (Model && Model.shellQuote) return Model.shellQuote(value)
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// route turns a line into { kind, command, summary, target }, or null when
// there is nothing to do. `kind` is what the overlay labels the action with
// before you commit to it, which is the point: you should be able to see where
// something is going before you send it.
function route(input) {
  var text = String(input || "").trim()
  if (text === "") return null

  var head = firstWord(text)
  var rest = text.slice(head.length).trim()

  // #channel — post a message.
  if (head.charAt(0) === "#" && head.length > 1) {
    if (rest === "") return null // a channel with nothing to say is not a send
    var channel = head.slice(1)
    return {
      kind: "send",
      summary: "Send to #" + channel,
      target: channel,
      command: "sal send " + quote(channel) + " " + quote(rest)
    }
  }

  // @agent — message an agent's DM.
  if (head.charAt(0) === "@" && head.length > 1) {
    if (rest === "") return null
    var agent = head.slice(1)
    return {
      kind: "agent",
      summary: "Ask @" + agent,
      target: agent,
      command: "sal agents message " + quote(agent) + " " + quote(rest)
    }
  }

  // /doc — start a document.
  if (head === "/doc") {
    if (rest === "") return null
    return {
      kind: "doc",
      summary: "New document: " + rest,
      target: rest,
      command: "sal docs new " + quote(rest)
    }
  }

  // ! — file a task, optionally due. `!2026-09-20 ship it` and `! ship it`
  // and `!ship it` all mean the same thing, because a grammar that cares
  // about a space is a grammar you get wrong at speed.
  if (text.charAt(0) === "!") {
    var body = text.slice(1).trim()
    var due = ""
    // One test covers both spellings. `!2026-09-20 x` and `! 2026-09-20 x`
    // differ only in where the bang ends, and the bang is gone by here.
    var maybeDate = firstWord(body)
    if (ISO_DATE.test(maybeDate)) {
      due = maybeDate
      body = body.slice(maybeDate.length).trim()
    }
    if (body === "") return null
    var command = "sal tasks add " + quote(body)
    if (due !== "") command += " --due " + quote(due)
    return {
      kind: "task",
      summary: due === "" ? "New task" : "New task, due " + due,
      target: body,
      due: due,
      command: command
    }
  }

  // ?query — find it. The one sigil that pulls rather than pushes, and the
  // reason there is no bar widget for notes, files or photos: `sal search`
  // already spans messages, tasks, documents and uploads, which is every
  // Tier 2 domain the phone gives its own app. The results land in the same
  // pane an answer does, so the field that captures a thought also finds one.
  if (text.charAt(0) === "?") {
    var query = text.slice(1).trim()
    if (query === "") return null
    return {
      kind: "search",
      summary: "Search for " + query,
      target: query,
      command: "sal search " + quote(query)
    }
  }

  // Anything else is a question. This is the default on purpose: the common
  // case for a field you summoned with a keystroke is a thought, and making
  // the common case the one with no sigil is what makes the sigils worth
  // learning.
  return {
    kind: "ask",
    summary: "Ask Claude",
    target: text,
    command: "sal ask " + quote(text)
  }
}

// streams reports whether the action answers in the overlay rather than
// finishing silently. Asking and searching do — both are questions, and the
// answer is the point. Everything else lands in the workspace and the
// overlay's job is to get out of the way.
function streams(routed) {
  return !!routed && (routed.kind === "ask" || routed.kind === "search")
}

// hint is what the field shows before anything is typed. It teaches the
// grammar by listing it, which is cheaper than documentation nobody opens.
function hint() {
  return "#channel · @agent · !task · /doc · ?find · or just ask"
}

function firstWord(text) {
  var match = String(text).match(/^\S+/)
  return match ? match[0] : ""
}

if (typeof module !== "undefined") {
  module.exports = { route: route, streams: streams, hint: hint }
}
