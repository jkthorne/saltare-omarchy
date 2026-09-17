import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// The bar button and its popup.
//
// Colours come from the host's theme, not from Saltare's. A bar widget that
// paints itself in its own brand inside someone else's palette is the one they
// uninstall in a week; the Saltare visual language belongs in surfaces that
// own the whole screen.
Panel {
  id: root
  moduleName: "saltare.workspace"
  ipcTarget: "saltare"

  readonly property var view: watch.view
  readonly property var rows: watch.rows

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color barMark: view.urgent
    ? (bar ? bar.urgent : Color.urgent)
    : (view.dim ? Qt.darker(barForeground, 1.55) : barForeground)

  property int cursor: 0
  property bool cursorActive: false

  function clampCursor() {
    if (rows.length === 0) { cursor = 0; return }
    if (cursor >= rows.length) cursor = rows.length - 1
    if (cursor < 0) cursor = 0
  }

  function moveCursor(dx, dy) {
    cursorActive = true
    if (dy === 0 || rows.length === 0) return
    cursor = (cursor + dy + rows.length) % rows.length
  }

  function run(command) {
    if (!command || command === "") return
    if (bar && typeof bar.run === "function") bar.run(command)
    else launcher.exec(["sh", "-c", command])
  }

  function activate() {
    clampCursor()
    if (rows.length === 0) return
    run(rows[cursor].command)
    root.close()
  }

  // `x` on a task completes it. The row strikes itself immediately and the
  // next published document is the confirmation — optimism is right here
  // because the file is about to tell the truth either way.
  function completeSelected() {
    clampCursor()
    if (rows.length === 0) return
    var row = rows[cursor]
    if (row.kind !== "task" || !row.complete) return
    completed[row.command] = true
    completedChanged()
    run(row.complete)
  }

  property var completed: ({})


  Watch {
    id: watch
    settings: root.settings
    onPublished: {
      root.clampCursor()
      root.completed = ({})
    }
  }

  Process { id: launcher }


  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    visible: root.view.visible
    iconComponent: Component {
      Item {
        Row {
          anchors.centerIn: parent
          spacing: Style.space(4)

          Text {
            anchors.verticalCenter: parent.verticalCenter
            text: "◈"
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            color: root.barMark
            opacity: root.view.dim ? 0.6 : 1.0
          }
          Text {
            anchors.verticalCenter: parent.verticalCenter
            visible: root.view.badge !== ""
            text: root.view.badge
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            font.strikeout: root.view.stale
            color: root.barMark
            opacity: root.view.dim ? 0.6 : 1.0
          }
        }
      }
    }
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton) watch.recheck()
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(400))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(560))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) {
        if (!root.cursorActive) { root.cursorActive = true; return }
        root.moveCursor(dx, dy)
      }
      onActivateRequested: if (root.cursorActive) root.activate()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (t === "r" || t === "R") watch.recheck()
        else if (t === "x" || t === "X") root.completeSelected()
        else if (t === "o" || t === "O") { root.run("sal open"); root.close() }
      }

      Flickable {
        id: panelFlick
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: column
          width: panelFlick.width
          spacing: Style.space(10)

          PanelHero {
            width: parent.width
            title: root.view.workspace
            meta: root.view.state === "ok"
              ? summaryLine()
              : root.view.fix ? root.view.fix.label : ""
            foreground: root.foreground
            fontFamily: root.fontFamily
          }

          // The explanation for every state that is not "ok". It names the
          // command that ends the state, because a screen that describes a
          // problem without naming its fix is a dead end.
          Text {
            width: parent.width
            visible: root.view.detail !== ""
            text: root.view.detail
            wrapMode: Text.WordWrap
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }

          Text {
            width: parent.width
            visible: root.view.fix !== null && root.view.fix.hint !== ""
            text: root.view.fix ? root.view.fix.hint : ""
            wrapMode: Text.WordWrap
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }

          Repeater {
            model: root.rows

            Item {
              required property var modelData
              required property int index
              width: column.width
              implicitHeight: rowBody.implicitHeight + (modelData.section !== "" ? heading.implicitHeight + Style.space(6) : 0)

              PanelSectionHeader {
                id: heading
                visible: modelData.section !== ""
                width: parent.width
                text: modelData.section
              }

              Rectangle {
                id: rowBody
                anchors.top: modelData.section !== "" ? heading.bottom : parent.top
                anchors.topMargin: modelData.section !== "" ? Style.space(6) : 0
                width: parent.width
                implicitHeight: rowText.implicitHeight + Style.space(8)
                radius: Style.space(4)
                color: root.cursorActive && root.cursor === index
                  ? Style.selectedFillFor(root.foreground, Color.accent)
                  : "transparent"

                Row {
                  id: rowText
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.leftMargin: Style.space(6)
                  anchors.rightMargin: Style.space(6)
                  spacing: Style.space(8)

                  Text {
                    width: parent.width - subLabel.width - parent.spacing
                    elide: Text.ElideRight
                    text: modelData.label
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    font.strikeout: !!root.completed[modelData.command]
                    color: modelData.urgent ? root.urgent : root.foreground
                  }
                  Text {
                    id: subLabel
                    text: modelData.sub || ""
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.bodySmall
                    color: root.dim
                  }
                }

                MouseArea {
                  anchors.fill: parent
                  hoverEnabled: true
                  onEntered: { root.cursorActive = true; root.cursor = index }
                  onClicked: { root.cursor = index; root.activate() }
                }
              }
            }
          }

          Text {
            width: parent.width
            visible: root.view.moreUnread > 0 || root.view.moreNotifications > 0
            text: "+" + (root.view.moreUnread + root.view.moreNotifications) + " more"
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }

          PanelSeparator { width: parent.width }

          Text {
            width: parent.width
            text: "j/k move · enter open · x complete · r refresh · o workspace"
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
          }
        }
      }
    }
  }

  function summaryLine() {
    var totals = root.view.totals
    var parts = []
    if (totals.unread > 0) parts.push(totals.unread + " unread")
    if (totals.mentions > 0) parts.push(totals.mentions + " mention" + (totals.mentions === 1 ? "" : "s"))
    if (totals.overdue > 0) parts.push(totals.overdue + " overdue")
    if (totals.due_today > 0) parts.push(totals.due_today + " due today")
    return parts.length === 0 ? "all clear" : parts.join(" · ")
  }
}
