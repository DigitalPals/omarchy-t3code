import QtQuick
import qs.Commons
import qs.Ui
import "AttentionState.js" as AttentionState

BorderSurface {
  id: root
  required property var threadData
  readonly property bool inputNeeded: threadData.phase === "inputNeeded"
  readonly property color attentionColor: AttentionState.attentionColor(String(threadData.phase), Color.urgent)

  signal activated(string threadId)
  signal pinRequested(string threadId, bool pinned)
  signal settleRequested(string threadId, bool settled)
  signal snoozeRequested(string threadId, bool snoozed)

  function phaseLabel(value) {
    if (value === "inputNeeded") return "INPUT"
    if (value === "approvalNeeded") return "APPROVAL"
    return String(value || "idle").toUpperCase()
  }

  function relativeTime(value) {
    var elapsed = Math.max(0, Date.now() - Date.parse(String(value || "")))
    if (!isFinite(elapsed)) return ""
    if (elapsed < 60000) return "now"
    if (elapsed < 3600000) return Math.floor(elapsed / 60000) + "m"
    if (elapsed < 86400000) return Math.floor(elapsed / 3600000) + "h"
    return Math.floor(elapsed / 86400000) + "d"
  }

  width: parent ? parent.width : implicitWidth
  height: content.implicitHeight + Style.spacing.rowPaddingX * 2
  radius: Style.cornerRadius
  color: hover.hovered
    ? Style.hoverFillFor(Color.foreground, Color.accent)
    : (root.inputNeeded ? Util.alpha(root.attentionColor, 0.055) : Util.alpha(Color.foreground, 0.035))
  borderSpec: root.threadData.attention
    ? Border.controlSpec("selected", Color.foreground, root.attentionColor)
    : Border.controlSpec("normal", Color.foreground, Color.accent)

  HoverHandler { id: hover }
  TapHandler { onTapped: root.activated(String(root.threadData.id)) }

  Column {
    id: content
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    anchors.margins: Style.spacing.rowPaddingX
    spacing: Style.spacing.sm

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Rectangle {
        width: Style.space(6)
        height: width
        radius: width / 2
        anchors.verticalCenter: parent.verticalCenter
        color: root.threadData.attention ? root.attentionColor
          : (root.threadData.phase === "working" || root.threadData.phase === "starting" ? Color.accent : Color.muted)
      }

      Text {
        width: parent.width - phase.implicitWidth - parent.spacing * 2 - Style.space(6)
        text: String(root.threadData.title || "Untitled thread")
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.subtitle
        font.bold: root.threadData.attention
        elide: Text.ElideRight
      }

      Text {
        id: phase
        text: root.phaseLabel(root.threadData.phase)
        color: root.threadData.attention ? root.attentionColor : Color.muted
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        font.bold: true
      }
    }

    Row {
      width: parent.width
      spacing: Style.spacing.md

      Text {
        width: parent.width - actions.implicitWidth - parent.spacing
        text: String(root.threadData.project || "") + "  ·  " + String(root.threadData.model || root.threadData.provider || "") + "  ·  " + root.relativeTime(root.threadData.latestActivityAt)
        color: Color.muted
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        elide: Text.ElideRight
      }

      Row {
        id: actions
        spacing: Style.spacing.xs

        Button {
          visible: root.threadData.lifecycle !== "snoozed" && root.threadData.canSnooze
          iconText: "󰒲"
          tooltipText: "Snooze for one day"
          horizontalPadding: Style.spacing.sm
          verticalPadding: Style.spacing.xxs
          onClicked: root.snoozeRequested(String(root.threadData.id), false)
        }
        Button {
          visible: root.threadData.lifecycle === "snoozed"
          iconText: "󰒱"
          tooltipText: "Wake"
          horizontalPadding: Style.spacing.sm
          verticalPadding: Style.spacing.xxs
          onClicked: root.snoozeRequested(String(root.threadData.id), true)
        }
        Button {
          visible: root.threadData.lifecycle !== "settled" && root.threadData.canSettle
          iconText: "󰄬"
          tooltipText: "Settle"
          horizontalPadding: Style.spacing.sm
          verticalPadding: Style.spacing.xxs
          onClicked: root.settleRequested(String(root.threadData.id), false)
        }
        Button {
          visible: root.threadData.lifecycle === "settled"
          iconText: "󰅖"
          tooltipText: "Unsettle"
          horizontalPadding: Style.spacing.sm
          verticalPadding: Style.spacing.xxs
          onClicked: root.settleRequested(String(root.threadData.id), true)
        }
        Button {
          visible: root.threadData.canPin
          iconText: root.threadData.pinned ? "󰐃" : "󰤱"
          tooltipText: root.threadData.pinned ? "Unpin" : "Pin"
          horizontalPadding: Style.spacing.sm
          verticalPadding: Style.spacing.xxs
          onClicked: root.pinRequested(String(root.threadData.id), root.threadData.pinned === true)
        }
      }
    }
  }
}
