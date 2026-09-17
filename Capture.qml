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

  property bool asking: false
  property string errorText: ""

  readonly property var routed: Capture.route(field.text)
  readonly property bool streaming: answer.text !== "" || asking

  function open(payloadJson) {
    errorText = ""
    answer.text = ""
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
  }

  function dismiss() {
    close()
    if (root.shell && typeof root.shell.hide === "function") root.shell.hide()
  }

  function submit() {
    var action = root.routed
    if (!action) return

    if (Capture.streams(action)) {
      answer.text = ""
      errorText = ""
      asking = true
      askProcess.command = ["sh", "-c", action.command]
      askProcess.running = true
      return
    }
    runProcess.command = ["sh", "-c", action.command]
    runProcess.running = true
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

  Process {
    id: askProcess
    running: false
    stdout: SplitParser {
      onRead: function(line) { answer.text += (answer.text === "" ? "" : "\n") + String(line) }
    }
    stderr: SplitParser { onRead: function(line) { root.errorText = String(line).trim() } }
    onExited: function(exitCode) {
      root.asking = false
      if (exitCode !== 0 && root.errorText === "") root.errorText = "sal exited " + exitCode
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
          onAccepted: root.submit()
          Keys.onPressed: function(event) {
            if (event.key === Qt.Key_C && (event.modifiers & Qt.ControlModifier)) {
              root.stopAsking()
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
          visible: root.streaming
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

        Text {
          width: parent.width
          text: root.asking ? "… ctrl+c stops · esc closes" : "enter sends · esc closes"
          color: Qt.darker(Color.menu.text, 1.55)
          font.family: Style.font.menuFamily
          font.pixelSize: Style.font.caption
        }
      }
    }
  }
}
