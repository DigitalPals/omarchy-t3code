pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import qs.Ui

Column {
  id: root
  required property string title
  required property var items
  property bool initiallyExpanded: true
  property bool expanded: initiallyExpanded

  signal threadActivated(string threadId)
  signal pinRequested(string threadId, bool pinned)
  signal settleRequested(string threadId, bool settled)
  signal snoozeRequested(string threadId, bool snoozed)

  width: parent ? parent.width : implicitWidth
  spacing: Style.spacing.md
  visible: items && items.length > 0

  Button {
    width: parent.width
    leftAlign: true
    iconText: root.expanded ? "󰅀" : "󰅂"
    text: root.title + "  " + String(root.items ? root.items.length : 0)
    foreground: Color.muted
    fontSize: Style.font.caption
    horizontalPadding: 0
    onClicked: root.expanded = !root.expanded
  }

  Column {
    visible: root.expanded
    width: parent.width
    spacing: Style.spacing.md

    Repeater {
      model: root.items || []
      ThreadRow {
        required property var modelData
        threadData: modelData
        onActivated: function(threadId) { root.threadActivated(threadId) }
        onPinRequested: function(threadId, pinned) { root.pinRequested(threadId, pinned) }
        onSettleRequested: function(threadId, settled) { root.settleRequested(threadId, settled) }
        onSnoozeRequested: function(threadId, snoozed) { root.snoozeRequested(threadId, snoozed) }
      }
    }
  }
}
