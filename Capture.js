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
  // spans messages, tasks, documents, uploads and the workspace directory in
  // one call, which is every Tier 2 domain the phone gives its own app. The
  // results land in the same pane an answer does, so the field that captures a
  // thought also finds one.
  //
  // The directory was the exception, and this comment asserted otherwise for a
  // while. /api/v1/search carries four types and never carried people, so
  // rubrica had no route from this desktop at all — not here, not in the bar,
  // not in `sal`. The CLI merges /members in now, which is what makes the
  // sentence above true rather than aspirational.
  if (text.charAt(0) === "?") {
    var query = text.slice(1).trim()
    if (query === "") return null
    return {
      kind: "search",
      summary: "Search for " + query,
      target: query,
      // --json before the query, not after: parseTrailing refuses a trailing
      // valueless flag, because it would otherwise be swallowed as a word of
      // the query.
      command: "sal search --json " + quote(query)
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

// Both questions answer in the overlay; they no longer answer the same way.
// An answer is prose and arrives a line at a time, so it streams into a pane.
// A search is a list of things you might now want to open, so it arrives whole
// and becomes rows. Saying "streams" of both was true of the plumbing and
// false of the product: it is what left the results unreachable.
function streams(routed) {
  return !!routed && routed.kind === "ask"
}

function finds(routed) {
  return !!routed && routed.kind === "search"
}

// rows turns `sal search --json` into the flat list the overlay draws, one
// entry per hit, each carrying the command its enter key runs — the invariant
// the bar widget's popup has always held and this surface never did.
//
// The kind tags are the ones `sal search` prints in a terminal, so the two
// readings of the same search name things the same way.
function rows(jsonText) {
  var doc = parseResults(jsonText)
  if (!doc) return []
  var out = []

  each(doc.messages, function (hit) {
    var channel = hit.channel || {}
    out.push({
      kind: "msg",
      label: oneLine(hit.body),
      sub: channel.slug ? "#" + channel.slug : "",
      command: channel.slug && hit.id
        ? "sal open message " + quote(channel.slug) + " " + String(hit.id)
        : ""
    })
  })

  each(doc.tasks, function (hit) {
    out.push({
      kind: "task",
      label: oneLine(hit.title),
      sub: hit.state || "",
      command: hit.slug ? "sal open task " + quote(hit.slug) : ""
    })
  })

  // A document or upload is opened at its address in the data tree when it has
  // one. Everything made through the API has none — which is everything `/doc`
  // has ever created — so the fallback is the leaf's own editor, and it is the
  // common case rather than the exception.
  each(doc.documents, function (hit) {
    out.push({
      kind: "doc",
      label: oneLine(hit.title),
      sub: hit.path || hit.slug || "",
      command: leafCommand("document", hit)
    })
  })

  each(doc.uploads, function (hit) {
    out.push({
      kind: "file",
      label: oneLine(hit.title),
      sub: hit.path || hit.slug || "",
      command: leafCommand("upload", hit)
    })
  })

  each(doc.people, function (hit) {
    out.push({
      kind: "person",
      label: oneLine(hit.name),
      sub: oneLine(hit.title) || hit.email || "",
      // A membership id, never the user id beside it.
      command: hit.id ? "sal open member " + String(hit.id) : ""
    })
  })

  // A hit with nothing to open is not drawn. The alternative is a row that
  // looks like every other row and does nothing when you press enter, which
  // is the thing this whole list exists to stop being.
  return out.filter(function (row) { return row.command !== "" })
}

function leafCommand(kind, hit) {
  if (hit.path) return "sal open data " + quote(hit.path)
  if (hit.slug) return "sal open " + kind + " " + quote(hit.slug)
  return ""
}

function parseResults(jsonText) {
  var text = String(jsonText || "").trim()
  if (text === "") return null
  try {
    var doc = JSON.parse(text)
    return (doc && typeof doc === "object") ? doc : null
  } catch (e) {
    // A search that printed something unparseable is a search with no rows,
    // not an exception thrown inside a shell.
    return null
  }
}

function each(value, fn) {
  if (!Array.isArray(value)) return
  for (var i = 0; i < value.length; i++) {
    if (value[i] && typeof value[i] === "object") fn(value[i])
  }
}

// A hit's body can carry newlines; a row is one line.
function oneLine(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\s+/g, " ").trim()
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
  module.exports = { route: route, streams: streams, finds: finds, rows: rows, hint: hint }
}
