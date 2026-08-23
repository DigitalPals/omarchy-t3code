pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import qs.Ui as Ui
import "BarState.js" as BarState

Ui.Panel {
  id: root
  moduleName: "io.github.digitalpals.omarchy-t3code"
  ipcTarget: "io.github.digitalpals.omarchy-t3code"

  readonly property var t3: bar?.shell?.serviceFor("io.github.digitalpals.omarchy-t3code")
  readonly property bool connected: t3 && t3.connectionPhase === "connected"
  readonly property bool hasAttention: t3 && t3.attentionCount > 0
  readonly property string stateText: BarState.stateLabel(t3)

  implicitWidth: icon.implicitWidth
  implicitHeight: icon.implicitHeight

  onOpenedChanged: {
    if (opened) panelContent.prepareForOpen(JSON.stringify({ route: "inbox" }))
  }

  Ui.WidgetButton {
    id: icon
    anchors.fill: parent
    bar: root.bar
    labelVisible: false
    hasVisualContent: true
    fixedWidth: vertical ? -1 : statusContent.implicitWidth + Style.space(16)
    fixedHeight: vertical ? statusContent.implicitWidth + Style.space(16) : -1
    active: root.hasAttention
    tooltipText: root.connected
      ? (root.hasAttention ? root.t3.attentionCount + " T3 threads need attention" : "T3 Inbox · connected")
      : "T3 Inbox · " + (root.t3 ? root.t3.connectionPhase : "starting")

    Row {
      id: statusContent
      anchors.centerIn: parent
      spacing: Style.space(6)
      rotation: icon.vertical ? 90 : 0

      Item {
        width: Style.space(16)
        height: width

        T3Mark {
          anchors.centerIn: parent
          width: Style.space(16)
          height: Style.space(11)
          markColor: icon.foreground
        }

        Rectangle {
          visible: root.hasAttention
          width: Style.space(11)
          height: width
          radius: width / 2
          anchors.right: parent.right
          anchors.top: parent.top
          color: Color.urgent
          Text {
            anchors.centerIn: parent
            text: root.t3 && root.t3.attentionCount > 9 ? "9+" : String(root.t3 ? root.t3.attentionCount : 0)
            color: Color.background
            font.family: Style.font.family
            font.pixelSize: Style.space(7)
            font.bold: true
          }
        }
      }

      Text {
        anchors.verticalCenter: parent.verticalCenter
        text: root.stateText
        color: icon.active ? icon.activeColor : icon.foreground
        font.family: icon.fontFamily
        font.pixelSize: Style.font.caption
        font.bold: root.hasAttention
      }
    }

    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton && root.t3) root.t3.refreshEnvironments()
      else root.toggle()
    }
  }

  Ui.KeyboardPanel {
    id: modal
    anchorItem: icon
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: panelContent
    contentWidth: modal.fittedContentWidth(Style.space(460))
    contentHeight: modal.cappedContentHeight(Style.space(720))

    Panel {
      id: panelContent
      anchors.fill: parent
      // serviceFor() can briefly yield undefined while Omarchy rebuilds the
      // bar before its service registry finishes loading. Normalize that
      // startup gap to null so Panel's guarded Loader stays inactive.
      service: root.t3 || null
      onCloseRequested: root.close()
    }
  }
}
