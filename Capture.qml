import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "Capture.js" as Capture

// One field, summoned by a keystroke, that decides where what you typed goes.
//
// The same idea saltareOS' launcher and saltare-ios' command surface are built
// on, read for a desktop. This is also where Saltare's own visual language
// belongs: it owns the whole screen for the second it is up, unlike the bar
// widget, which wears the user's theme because it lives in the user's bar.
//
// It holds no session. Every route ends in a `sal` argv built by Capture.js.
//
// The root is an Item and the window is its child, because the shell summons an
// overlay by calling open()/close() on whatever the entry point loads.
Item {
  id: root

  property var shell: null
  property var manifest: null
  property bool opened: false

  // Every call on the shell names the plugin it acts on, and the scoped API
  // hands back false for a target we do not own. "" is owned by nobody.
  readonly property string pluginId: (manifest && manifest.id) || "saltare.workspace"

  property bool asking: false
  property string errorText: ""

  // A streaming command's stderr is not an error until it exits saying so.
  // `sal search` prints "no results" there and exits 0, and painting that red
  // would be the overlay calling a search that worked a failure.
  property string streamNotice: ""

  property bool searching: false
  property string searchBuffer: ""

  // The rows a search became, and where the cursor is in them. Selection lives
  // here rather than on the view, the way every host overlay keeps it, because
  // the list is rebuilt wholesale on each search and a view's own currentIndex
  // would not survive that.
  property var rows: []
  property int selectedIndex: 0
  property bool cursorActive: false

  readonly property var routed: Capture.route(field.text)
  readonly property bool streaming: answer.text !== "" || asking
  readonly property bool listing: rows.length > 0
  // A Process that is already running ignores a new command and ignores
  // running = true, so a second enter did nothing — except, on a route that
  // streams, blank the pane it had just filled. One in flight at a time, and
  // the line under the field says which.
  readonly property bool busy: asking || searching || runProcess.running

  function open(payloadJson) {
    errorText = ""
    streamNotice = ""
    answer.text = ""
    clearRows()
    opened = true
    Qt.callLater(function() { field.forceActiveFocus() })
  }

  function close() {
    // esc keeps nothing: a field you summoned with a keystroke has to be
    // faster to dismiss than to regret.
    stopAsking()
    opened = false
    field.text = ""
    answer.text = ""
    errorText = ""
    streamNotice = ""
    clearRows()
  }

  function clearRows() {
    rows = []
    selectedIndex = 0
    cursorActive = false
    searchBuffer = ""
  }

  // close() is ours — it empties the field and drops the window. dismiss() also
  // tells the host, which is what releases the summon. Calling hide() with no
  // argument looked like it worked, because the window goes either way; what
  // it actually did was leave the plugin marked open in the shell for the rest
  // of the session.
  function dismiss() {
    close()
    if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)
  }

  // Enter means two things now, and which one it means is whether a row is
  // selected. With a cursor it opens that row; without one it is the send or
  // the search it has always been.
  function activate() {
    if (cursorActive && rows.length > 0) {
      var row = rows[Math.max(0, Math.min(selectedIndex, rows.length - 1))]
      if (!row || !row.command) return
      // Dismiss before spawning, the way every host overlay does: the layer
      // surface holds an exclusive keyboard grab, and the browser about to
      // open wants it.
      dismiss()
      launcher.exec(["sh", "-c", row.command])
      return
    }
    submit()
  }

  function moveSelection(delta) {
    if (rows.length === 0) return
    if (!cursorActive) {
      cursorActive = true
      selectedIndex = delta > 0 ? 0 : rows.length - 1
    } else {
      selectedIndex = (selectedIndex + delta + rows.length) % rows.length
    }
    resultList.positionViewAtIndex(selectedIndex, ListView.Contain)
  }

  function submit() {
    var action = root.routed
    if (!action || root.busy) return

    if (Capture.finds(action)) {
      clearRows()
      errorText = ""
      streamNotice = ""
      searching = true
      searchProcess.command = ["sh", "-c", action.command]
      searchProcess.running = true
      return
    }

    if (Capture.streams(action)) {
      clearRows()
      answer.text = ""
      errorText = ""
      streamNotice = ""
      asking = true
      askProcess.command = ["sh", "-c", action.command]
      askProcess.running = true
      return
    }
    runProcess.command = ["sh", "-c", action.command]
    runProcess.running = true
  }

  // say appends one line to the pane, which is also how the stdout parser
  // fills it — one definition of "what a line looks like in there".
  function say(line) {
    if (!line) return
    answer.text += (answer.text === "" ? "" : "\n") + line
  }

  function stopAsking() {
    if (askProcess.running) askProcess.running = false
    asking = false
  }

  Process {
    id: runProcess
    running: false
    stderr: SplitParser { onRead: function(line) { root.errorText = String(line).trim() } }
    onExited: function(exitCode) {
      // Zero means it landed in the workspace and there is nothing left to
      // look at. Non-zero keeps the text, because losing what someone typed is
      // the one unforgivable failure for a capture field.
      if (exitCode === 0) root.dismiss()
      else if (root.errorText === "") root.errorText = "sal exited " + exitCode
    }
  }

  // Opening a row is fire-and-forget: the overlay is already gone by the time
  // this runs, so there is nothing left to report an exit code to.
  Process { id: launcher }

  // A search arrives as one JSON document rather than a line at a time, so it
  // is collected and parsed at exit. The streaming pane below is for prose.
  Process {
    id: searchProcess
    running: false
    stdout: SplitParser { onRead: function(line) { root.searchBuffer += String(line) + "\n" } }
    stderr: SplitParser { onRead: function(line) { root.streamNotice = String(line).trim() } }
    onExited: function(exitCode) {
      root.searching = false
      if (exitCode === 0) {
        root.rows = Capture.rows(root.searchBuffer)
        // `sal search` prints "no results" on stderr and exits 0, which is a
        // result and not a failure — the same reason the ask pane holds its
        // stderr until the exit code says what it was.
        if (root.rows.length === 0 && root.streamNotice === "") root.streamNotice = "no results"
      } else {
        root.errorText = root.streamNotice !== "" ? root.streamNotice : "sal exited " + exitCode
        root.streamNotice = ""
      }
      root.searchBuffer = ""
      root.selectedIndex = 0
      root.cursorActive = false
    }
  }

  Process {
    id: askProcess
    running: false
    stdout: SplitParser {
      onRead: function(line) { root.say(String(line)) }
    }
    stderr: SplitParser { onRead: function(line) { root.streamNotice = String(line).trim() } }
    onExited: function(exitCode) {
      root.asking = false
      if (exitCode === 0) root.say(root.streamNotice)
      else root.errorText = root.streamNotice !== "" ? root.streamNotice : "sal exited " + exitCode
      root.streamNotice = ""
    }
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "saltare-capture"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: Color.menu.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    Rectangle {
      id: card
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.top: parent.top
      anchors.topMargin: panel.height * 0.22
      width: Math.min(panel.width - Style.gapsOut * 2, Style.space(720))
      implicitHeight: body.implicitHeight + Style.space(32)
      radius: Style.cornerRadius
      color: Color.menu.background
      border.color: Color.menu.border
      border.width: 1

      // Swallow clicks so the backdrop's dismiss does not fire through.
      MouseArea { anchors.fill: parent; onClicked: {} }

      Column {
        id: body
        anchors.centerIn: parent
        width: parent.width - Style.space(32)
        spacing: Style.space(10)

        TextField {
          id: field
          width: parent.width
          placeholderText: Capture.hint()
          color: Color.menu.text
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.heading
          background: Rectangle { color: "transparent" }

          Keys.onEscapePressed: root.dismiss()
          onAccepted: root.activate()
          // The field keeps focus and drives the list from here, which is the
          // weather panel's idiom. The other one the shell uses — a bare
          // key-catcher with Keys.priority: Keys.BeforeItem over the whole
          // card — would eat every keystroke meant for this field.
          Keys.onPressed: function(event) {
            // ctrl+c is the field's until something is streaming into the pane
            // below it. Taking it unconditionally meant you could not copy what
            // you had typed out of a field whose whole job is what you typed.
            if (event.key === Qt.Key_C && (event.modifiers & Qt.ControlModifier)
                && root.asking) {
              root.stopAsking()
              event.accepted = true
            } else if (event.key === Qt.Key_Down && root.listing) {
              root.moveSelection(1)
              event.accepted = true
            } else if (event.key === Qt.Key_Up && root.listing) {
              root.moveSelection(-1)
              event.accepted = true
            }
          }
        }

        // What will happen, before you commit to it. Being able to see where
        // something is going is the point of a field that routes.
        Text {
          width: parent.width
          visible: root.routed !== null
          text: root.routed ? root.routed.summary : ""
          color: Color.accent
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.bodySmall
        }

        Text {
          width: parent.width
          visible: root.errorText !== ""
          text: root.errorText
          wrapMode: Text.WordWrap
          color: Color.urgent
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.bodySmall
        }

        PanelSeparator {
          width: parent.width
          visible: root.streaming || root.listing
        }

        // A search becomes rows, and every row knows the command its enter key
        // runs — the invariant the bar widget's popup has always held. Before
        // this the results were one Text, which nothing could select, click or
        // reach with a key.
        ListView {
          id: resultList
          width: parent.width
          height: Math.min(contentHeight, Style.space(320))
          visible: root.listing
          model: root.rows
          clip: true
          interactive: contentHeight > height
          boundsBehavior: Flickable.StopAtBounds
          // The field owns the keyboard; the view must not fight it for the
          // arrow keys it is already handling.
          keyNavigationEnabled: false

          delegate: Rectangle {
            required property var modelData
            required property int index

            width: ListView.view.width
            implicitHeight: rowText.implicitHeight + Style.space(8)
            radius: Style.space(4)
            // Selection is read off the root, not the view: the model is
            // replaced wholesale on every search.
            readonly property bool hasCursor: root.cursorActive && index === root.selectedIndex
            color: hasCursor ? Style.selectedFillFor(Color.menu.text, Color.accent) : "transparent"

            Row {
              id: rowText
              anchors.verticalCenter: parent.verticalCenter
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.leftMargin: Style.space(6)
              anchors.rightMargin: Style.space(6)
              spacing: Style.space(8)

              Text {
                width: Style.space(52)
                text: modelData.kind
                color: Color.accent
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.bodySmall
              }
              Text {
                width: parent.width - Style.space(52) - sub.width - parent.spacing * 2
                elide: Text.ElideRight
                text: modelData.label
                color: Color.menu.text
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.body
              }
              Text {
                id: sub
                text: modelData.sub || ""
                elide: Text.ElideLeft
                color: Qt.darker(Color.menu.text, 1.55)
                font.family: Style.font.menuFamily
                font.pixelSize: Style.font.bodySmall
              }
            }

            MouseArea {
              anchors.fill: parent
              hoverEnabled: true
              onEntered: { root.cursorActive = true; root.selectedIndex = index }
              onClicked: { root.selectedIndex = index; root.cursorActive = true; root.activate() }
            }
          }
        }

        Text {
          id: answer
          width: parent.width
          visible: root.streaming
          text: ""
          wrapMode: Text.WordWrap
          color: Color.menu.text
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.body
        }

        // A search that found nothing said so on stderr and exited 0, which is
        // a result. It gets a line rather than the red the error pane paints.
        Text {
          width: parent.width
          visible: root.streamNotice !== "" && !root.listing && !root.streaming
          text: root.streamNotice
          wrapMode: Text.WordWrap
          color: Qt.darker(Color.menu.text, 1.55)
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.bodySmall
        }

        Text {
          width: parent.width
          text: root.asking ? "… ctrl+c stops · esc closes"
            : root.searching ? "searching…"
            : runProcess.running ? "sending…"
            : root.listing ? "↑↓ move · enter opens · esc closes"
            : "enter sends · esc closes"
          color: Qt.darker(Color.menu.text, 1.55)
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.caption
        }
      }
    }
  }
}
