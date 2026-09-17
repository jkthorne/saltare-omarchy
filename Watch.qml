import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model

// The entire data layer. It watches one file and looks for one binary.
//
// There is no HTTP here, no websocket, no token and no retry: `sal watch`
// holds the session and publishes a JSON document, and this reads it. That is
// deliberate — a bar widget is instantiated once per monitor, so a widget that
// opened its own connection would open two on a two-monitor desk and announce
// every mention twice.
Item {
  id: root
  visible: false

  property var settings: ({})
  property var snapshot: Model.missing()
  property bool salPresent: false

  // Staleness has to keep being true while the panel sits open, so the clock
  // ticks on its own rather than only when the file changes.
  property double nowMs: Date.now()

  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string statePath: Model.statePath(
    settings ? settings.statePath : "", Quickshell.env("XDG_STATE_HOME"), home)

  readonly property var view: Model.view(snapshot, nowMs, settings, salPresent)
  readonly property var rows: Model.rows(view)

  signal published()

  FileView {
    id: file
    path: root.statePath
    watchChanges: true
    printErrors: false
    // The daemon publishes through a temp sibling and a rename, which is what
    // makes a half-written document impossible to observe — and what this
    // reload is watching for.
    onFileChanged: reload()
    onLoaded: {
      root.snapshot = Model.parse(text())
      root.nowMs = Date.now()
      root.published()
    }
    onLoadFailed: {
      root.snapshot = Model.missing()
      root.published()
    }
  }

  // Looked up once, not polled. A CLI installed mid-session appears on the
  // next shell reload, which is the same bargain omarchy.agents makes.
  Process {
    id: probe
    running: true
    command: ["sh", "-c", "command -v sal >/dev/null 2>&1"]
    onExited: function(exitCode) { root.salPresent = exitCode === 0 }
  }

  Timer {
    interval: 10000
    running: true
    repeat: true
    onTriggered: root.nowMs = Date.now()
  }

  function recheck() {
    probe.running = true
    file.reload()
  }
}
