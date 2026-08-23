pragma ComponentBehavior: Bound

import QtQuick
import qs.Commons
import qs.Ui

Column {
  id: root
  required property string title
  required property var items
  property var environments: []
  property bool showEnvironment: false
  property bool initiallyExpanded: true
  property bool expanded: initiallyExpanded

  signal threadActivated(string environmentId, string threadId)
  signal pinRequested(string environmentId, string threadId, bool pinned)
  signal settleRequested(string environmentId, string threadId, bool settled)
  signal snoozeRequested(string environmentId, string threadId, bool snoozed)

  function environmentLabel(environmentId) {
    var values = root.environments || []
    for (var i = 0; i < values.length; i++)
      if (String(values[i].id) === String(environmentId)) return String(values[i].label)
    return "Unknown computer"
  }

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
        environmentLabel: root.showEnvironment ? root.environmentLabel(modelData.environmentId) : ""
        onActivated: function(threadId) { root.threadActivated(String(modelData.environmentId), threadId) }
        onPinRequested: function(threadId, pinned) { root.pinRequested(String(modelData.environmentId), threadId, pinned) }
        onSettleRequested: function(threadId, settled) { root.settleRequested(String(modelData.environmentId), threadId, settled) }
        onSnoozeRequested: function(threadId, snoozed) { root.snoozeRequested(String(modelData.environmentId), threadId, snoozed) }
      }
    }
  }
}
