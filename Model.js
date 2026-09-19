// Model.js — every decision the Saltare bar widget makes, as pure functions.
//
// The QML in this repo is a renderer: it watches one file, hands the text to
// parse(), hands the result to view(), and draws what comes back. Keeping the
// logic here is what makes it testable under `node --test`, and Omarchy's QML
// API is young enough that the parts worth protecting from it are the parts
// that decide things.
//
// Nothing here does I/O, reads a clock, or knows what QML is.

var SCHEMA = 1

// ── the snapshot ────────────────────────────────────────────────────────
//
// A snapshot is what the file said, or why it didn't say anything.

function empty() {
  return { status: "empty", doc: null, error: "" }
}

function missing() {
  return { status: "missing", doc: null, error: "" }
}

function parse(text) {
  if (!text || String(text).trim() === "") return missing()
  var doc
  try {
    doc = JSON.parse(String(text))
  } catch (e) {
    // A file caught mid-rename would land here. The daemon writes through a
    // temp sibling precisely so it shouldn't, but a parse error is a state to
    // show rather than an exception to throw inside a bar.
    return { status: "unreadable", doc: null, error: String(e && e.message || e) }
  }
  if (!doc || typeof doc !== "object") return { status: "unreadable", doc: null, error: "not an object" }
  if (doc.schema !== SCHEMA) {
    return { status: "unsupported", doc: doc, error: "schema " + doc.schema }
  }
  return { status: "loaded", doc: doc, error: "" }
}

// statePath mirrors the daemon's own resolution: XDG_STATE_HOME, else
// ~/.local/state. An explicit setting wins over both, and "~" is expanded
// because a person typing a path into a settings field will type one.
function statePath(setting, xdgStateHome, home) {
  var configured = String(setting || "").trim()
  if (configured !== "") {
    if (configured.indexOf("~/") === 0) return String(home || "") + configured.slice(1)
    return configured
  }
  var base = String(xdgStateHome || "").trim()
  if (base === "") base = String(home || "") + "/.local/state"
  return base + "/saltare/watch.json"
}

// ── the view ────────────────────────────────────────────────────────────

// Staleness follows the daemon's own heartbeat by default: three missed beats,
// the same rule State.Stale uses in saltare-cli. The document carries
// heartbeat_sec precisely so both ends can agree without hardcoding a number
// twice — which they briefly did not, and a bar widget saying "ok" beside a
// waybar module saying "stopped" is the seam leaking into the user's face.
var DEFAULT_HEARTBEAT_SEC = 30
var MISSED_BEATS = 3

// STATES in precedence order. The order is the argument:
//
//   setup outranks everything, because no CLI means no instruction below it
//   can be followed.
//   unsupported and unreadable come next: a document we cannot read is one
//   whose `state` field we have no right to trust either.
//   signin outranks stopped, because restarting a watcher that has nothing to
//   sign in with fixes nothing.
//   stopped outranks offline, because a dead watcher explains a dropped
//   socket and not the other way round.
//   offline outranks a mention, because "these numbers are last-known"
//   matters more than "someone called your name" when both are true.
// salPresent is deliberately tri-state. Looking for the CLI is an async
// process launch, so for the first frames after the shell starts we do not
// know — and "setup" is the worst thing to guess, because it tells someone who
// already installed sal to go install it. Unknown says "checking" instead.
function state(snapshot, nowMs, settings, salPresent) {
  var doc = snapshot && snapshot.doc
  var loaded = snapshot && snapshot.status === "loaded" && doc

  if (!loaded && salPresent === null) return "probing"
  if (!loaded && salPresent === undefined) return "probing"
  if (!loaded && !salPresent) return "setup"
  if (snapshot && snapshot.status === "unsupported") return "unsupported"
  // A file that is there and will not parse is not a missing session, and
  // telling someone to sign in is a fix that cannot work. The daemon renames a
  // temp sibling into place so this should only ever be a frame long — but a
  // write that ran out of disk, or a file edited by hand, stays this way.
  if (snapshot && snapshot.status === "unreadable") return "unreadable"
  if (!loaded) return "signin"
  if (doc.state === "logged-out") return "signin"
  if (isStale(doc, nowMs, settings)) return "stopped"
  // A server that answered and refused is not an outage. Saying "offline"
  // there sends someone to check a connection that was never the problem —
  // which is exactly what the first live run of the daemon did, against a
  // workspace that had simply hit its monthly request cap.
  if (doc.state === "blocked") return "blocked"
  if (doc.state === "unreachable" || doc.live === false) return "offline"
  return "ok"
}

function isStale(doc, nowMs, settings) {
  return ageSeconds(doc, nowMs) > staleLimit(doc, settings)
}

// staleLimit is three of the daemon's heartbeats, unless the user has set an
// explicit patience. 0 or unset means "follow the daemon".
function staleLimit(doc, settings) {
  var configured = number(settings && settings.staleAfterSec, 0)
  if (configured > 0) return configured
  var beat = number(doc && doc.heartbeat_sec, DEFAULT_HEARTBEAT_SEC)
  if (beat <= 0) beat = DEFAULT_HEARTBEAT_SEC
  return MISSED_BEATS * beat
}

function ageSeconds(doc, nowMs) {
  var at = Date.parse(doc && doc.updated_at)
  if (isNaN(at)) return Infinity
  return Math.max(0, (nowMs - at) / 1000)
}

// fixFor names the command that ends each state. A state screen that describes
// a problem without naming its fix is a dead end, and the setup state is the
// one place we genuinely have nothing to run — so it says so rather than
// offering a button that cannot work.
function fixFor(name) {
  switch (name) {
  case "probing":
    return null
  case "setup":
    return {
      label: "Install the sal CLI",
      run: "",
      hint: "Then run: sal login — and reload with omarchy-shell shell rescanPlugins"
    }
  case "signin":
    return { label: "Sign in", run: "omarchy-launch-tui sal login", hint: "" }
  case "stopped":
    return {
      label: "Start the watcher",
      run: "omarchy-launch-tui sal watch --install-service",
      hint: ""
    }
  case "offline":
    return { label: "Retry now", run: "sal watch --once", hint: "" }
  case "blocked":
    // No retry and no re-login fixes this, so neither is offered.
    return { label: "Check the session", run: "omarchy-launch-tui sal doctor", hint: "" }
  case "unsupported":
    return {
      label: "Update the plugin",
      run: "omarchy-launch-tui omarchy plugin update saltare.workspace",
      hint: ""
    }
  case "unreadable":
    // Nothing here can repair the file; the daemon is the only thing that
    // writes it, so the fix is to make it write a whole one.
    return { label: "Rewrite the state file", run: "sal watch --once", hint: "" }
  default:
    return null
  }
}

function detailFor(name, doc, nowMs, error) {
  switch (name) {
  case "probing":
    return "Looking for the sal CLI…"
  case "setup":
    return "This widget reads a file the sal CLI writes. Nothing is installed yet."
  case "signin":
    return "Sign in to a workspace and the counts appear here."
  case "stopped":
    return "The watcher isn't running — showing what it last knew, " + agoLabel(doc, nowMs) + "."
  case "offline":
    var where = doc && doc.server ? doc.server : "the server"
    return "Can't reach " + where + " — showing the last known state, " + agoLabel(doc, nowMs) + "."
  case "blocked":
    // The server's own sentence. It is the only thing here that says what to
    // do about it, and inventing a paraphrase would lose that.
    return (doc && doc.error) ? String(doc.error) : "The server refused the request."
  case "unsupported":
    return "This state file was written by a newer sal than this plugin understands."
  case "unreadable":
    // The parser's own sentence. It is the difference between "something is
    // wrong with a file" and knowing which file, at which byte.
    return "The state file did not parse" + (error ? " — " + error : "") + "."
  default:
    return ""
  }
}

// view is the whole render contract. QML reads these fields and draws them.
function view(snapshot, nowMs, settings, salPresent) {
  var name = state(snapshot, nowMs, settings, salPresent)
  var doc = (snapshot && snapshot.doc) || null
  var usable = name !== "setup" && name !== "signin" && name !== "unsupported"
    && name !== "unreadable" && name !== "probing" && doc
  var totals = (usable && doc.totals) || { unread: 0, mentions: 0, notifications: 0, overdue: 0, due_today: 0, mail: 0 }

  var mailList = list(usable && doc.mail)
  var channels = list(usable && doc.channels).filter(isObject)
  var work = (usable && doc.work) || null
  var listed = 0
  for (var i = 0; i < channels.length; i++) listed += number(channels[i].unread, 0)

  return {
    state: name,
    // A bar widget that draws nothing when there is nothing to say is the one
    // people keep. showWhenIdle defaults on, because someone who just
    // installed this deserves to see that it worked.
    //
    // "Waiting" is the four counts you would act on today. Mail is not among
    // them on purpose: it is a line rather than a section for the same reason
    // — nothing in this popup opens it — and an unread message can sit in a
    // mailbox for a month, which would pin the widget on and make the setting
    // mean nothing.
    visible: name !== "ok" || totals.unread > 0 || totals.mentions > 0
      || totals.overdue > 0 || totals.due_today > 0
      || bool(settings && settings.showWhenIdle, true),
    // Stale counts are shown struck through rather than blanked: a bar that
    // drops to zero when its feed dies has told you something false.
    stale: name === "stopped",
    dim: name !== "ok" && name !== "offline" && name !== "blocked",
    badge: badge(totals.unread),
    urgent: number(totals.mentions, 0) > 0 && (name === "ok" || name === "offline" || name === "blocked"),
    workspace: (usable && doc.workspace && doc.workspace.name) || "Saltare",
    server: (doc && doc.server) || "",
    detail: detailFor(name, doc, nowMs, (snapshot && snapshot.error) || ""),
    fix: fixFor(name),
    age: usable ? agoLabel(doc, nowMs) : "",
    totals: totals,
    channels: channels.map(decorateChannel),
    notifications: list(usable && doc.notifications).filter(isObject),
    work: { overdue: list(work && work.overdue), today: list(work && work.today) },
    // Mail is a number in the summary line and nothing more, and the reason is
    // the invariant one row below: every row in this popup knows the command
    // its enter key runs. A mail row could not — there is no mail client on
    // this desktop and no web mailbox on the server, because posta is the
    // phone's. A count you glance at is the whole job of a bar widget; a
    // section of rows that open nothing would be a door painted on a wall.
    // doc.mail is the per-account list, carried for whoever builds that door.
    mail: mailList,
    mailLine: mailLine(totals, mailList),
    moreUnread: Math.max(0, number(totals.unread, 0) - listed),
    moreNotifications: Math.max(0, number(totals.notifications, 0) - list(usable && doc.notifications).length)
  }
}

// mailLine is the one place mail appears. It is a sentence rather than a row
// because every row in this popup runs a command on enter, and a mail row
// could not: there is no mail client on this desktop and no web mailbox on the
// server, because posta is the phone's. It is a line of its own rather than a
// fifth count in the hero because the hero elides — four counts already clip
// "1 due today" there, so a fifth would be written and never read.
//
// Naming the account is the part a bare number cannot do, and the part that
// earns the line.
function mailLine(totals, mail) {
  var unread = number(totals && totals.mail, 0)
  if (unread <= 0) return ""
  // "mail" is uncountable, so there is no plural to get wrong.
  var boxes = []
  var accounts = list(mail).filter(isObject)
  for (var i = 0; i < accounts.length; i++) {
    if (number(accounts[i].unread, 0) > 0) {
      boxes.push(String(accounts[i].name || accounts[i].address || ""))
    }
  }
  if (boxes.length === 1) return unread + " unread mail in " + boxes[0]
  if (boxes.length > 1) return unread + " unread mail across " + boxes.length + " accounts"
  // A count with no list behind it: the daemon capped the list, or a reader is
  // holding a document older than its totals. Say the number and stop.
  return unread + " unread mail"
}

// badge is what fits in a bar. Zero draws nothing rather than a "0", and past
// ninety-nine the exact number has stopped being information.
function badge(unread) {
  var n = number(unread, 0)
  if (n <= 0) return ""
  if (n > 99) return "99+"
  return String(n)
}

// channelLabel puts the sigil back on. The daemon deliberately sends a bare
// title, because a conversation's title is a name and prefixing it with "#"
// would be a lie about what it is.
//
// The kinds are the server's enum (app/models/channel.rb): public_channel,
// private_channel, dm, discussion, agent_dm, thread, agent_collaboration.
// Guessing at them is how "#DevOps Monitor" reached a live bar — only the two
// real channel kinds take a hash.
function channelLabel(channel) {
  var title = String((channel && channel.title) || "")
  switch (channel && channel.kind) {
  case "public_channel":
  case "private_channel":
    return "#" + title
  case "thread":
  case "discussion":
    return "↳ " + title
  default:
    // dm, agent_dm, agent_collaboration, and anything the server adds later:
    // a name stands on its own, and an unknown kind is safer bare than wrong.
    return title
  }
}

function decorateChannel(channel) {
  return {
    slug: channel.slug,
    title: channel.title,
    kind: channel.kind,
    unread: channel.unread,
    mentioned: !!channel.mentioned,
    label: channelLabel(channel)
  }
}

// notificationLine reads the way the web app's own notification does: who,
// what the server called it, and where.
function notificationLine(note) {
  var who = String((note && note.actor) || "Saltare")
  var what = String((note && note.description) || "")
  var line = what === "" ? who : who + " " + what
  if (note && note.channel_slug) line += " in #" + note.channel_slug
  return line
}

function agoLabel(doc, nowMs) {
  var seconds = ageSeconds(doc, nowMs)
  if (!isFinite(seconds)) return "at some point"
  if (seconds < 60) return "just now"
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago"
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago"
  return Math.floor(seconds / 86400) + "d ago"
}

// rows flattens the popup into one navigable list. Keyboard navigation over a
// flat list with a section label on each row is far less code than a cursor
// that knows about sections — and it is the part a test can actually hold.
function rows(v) {
  var out = []
  if (!v || v.state === "setup" || v.state === "signin" || v.state === "unsupported"
      || v.state === "unreadable" || v.state === "probing") {
    if (v && v.fix && v.fix.run !== "") {
      out.push({ kind: "fix", section: "", label: v.fix.label, sub: "", command: v.fix.run })
    }
    return out
  }

  var i
  for (i = 0; i < v.notifications.length; i++) {
    var note = v.notifications[i]
    out.push({
      kind: "notification",
      section: i === 0 ? "MENTIONS" : "",
      label: notificationLine(note),
      sub: note.preview || note.task_title || "",
      command: note.channel_slug
        ? openCommand("channel", note.channel_slug)
        : openCommand("task", note.task_slug)
    })
  }
  for (i = 0; i < v.channels.length; i++) {
    var channel = v.channels[i]
    out.push({
      kind: "channel",
      section: i === 0 ? "UNREAD" : "",
      label: channel.label,
      sub: String(channel.unread),
      urgent: channel.mentioned,
      command: openCommand("channel", channel.slug)
    })
  }
  var work = v.work.overdue.concat(v.work.today)
  for (i = 0; i < work.length; i++) {
    var task = work[i]
    out.push({
      kind: "task",
      section: i === 0 ? "WORK" : "",
      label: task.title,
      sub: task.due_date,
      urgent: i < v.work.overdue.length,
      command: openCommand("task", task.slug),
      complete: completeCommand(task.slug)
    })
  }
  if (v.fix && v.fix.run !== "") {
    out.push({ kind: "fix", section: "", label: v.fix.label, sub: "", command: v.fix.run })
  }
  return out
}

// openCommand is the argv a row's enter key runs. Everything the widget does
// to the workspace goes through the CLI that holds the session; this file
// never sees a token and never makes a request.
function openCommand(kind, slug) {
  if (!slug) return ""
  return "sal open " + kind + " " + shellQuote(String(slug))
}

function completeCommand(slug) {
  if (!slug) return ""
  return "sal tasks complete " + shellQuote(String(slug))
}

// shellQuote exists because these strings come off the wire. A channel slug is
// tame, but "tame in practice" is how a command injection gets written.
function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

// list and isObject are the same argument number() and bool() make. The
// document is a seam between two repos that release separately, and a field
// that arrives as the wrong shape should draw nothing — `[].concat(undefined)`
// is `[undefined]`, and the line after it reads .title off it inside a bar.
function list(value) {
  return Array.isArray(value) ? value : []
}

function isObject(value) {
  return !!value && typeof value === "object"
}

function number(value, fallback) {
  var n = Number(value)
  return isFinite(n) ? n : fallback
}

function bool(value, fallback) {
  if (value === undefined || value === null) return fallback
  return !!value
}

if (typeof module !== "undefined") {
  module.exports = {
    SCHEMA: SCHEMA,
    empty: empty,
    missing: missing,
    parse: parse,
    statePath: statePath,
    state: state,
    view: view,
    rows: rows,
    badge: badge,
    channelLabel: channelLabel,
    notificationLine: notificationLine,
    mailLine: mailLine,
    agoLabel: agoLabel,
    ageSeconds: ageSeconds,
    staleLimit: staleLimit,
    fixFor: fixFor,
    openCommand: openCommand,
    completeCommand: completeCommand,
    shellQuote: shellQuote,
    list: list
  }
}
