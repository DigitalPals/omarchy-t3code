import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

Item {
  id: root
  required property var service
  signal closeRequested()

  property bool creating: false
  property string selectedProject: ""
  property string selectedModel: ""
  property var selectedModelOptions: []
  property string selectedModelOptionsFor: ""
  property string selectedRuntimeMode: "approval-required"
  property string pendingRuntimeMode: ""
  readonly property string formattedInboxUpdatedAt: formatUpdatedAt(root.service.inbox.updatedAt)

  function formatUpdatedAt(value) {
    var timestamp = new Date(String(value || ""))
    if (isNaN(timestamp.getTime())) return ""
    return timestamp.toLocaleString(Qt.locale(), Locale.ShortFormat)
  }

  function environmentOptions() {
    var result = []
    var values = root.service.environments || []
    for (var i = 0; i < values.length; i++)
      result.push({ value: String(values[i].id), label: String(values[i].label) + (values[i].status ? " · " + values[i].status : "") })
    return result
  }

  function projectOptions() {
    var result = []
    var values = root.service.inbox.projects || []
    for (var i = 0; i < values.length; i++) result.push({ value: String(values[i].id), label: String(values[i].title) })
    return result
  }

  function modelOptions() {
    var result = []
    var values = root.service.models || []
    for (var i = 0; i < values.length; i++) if (values[i].available)
      result.push({
        value: String(values[i].instanceId) + "\u001f" + String(values[i].model),
        label: String(values[i].providerLabel) + " · " + String(values[i].label),
        providerLabel: String(values[i].providerLabel),
        modelLabel: String(values[i].label)
      })
    return result
  }

  function descriptorsForModel(value) {
    var models = root.service.models || []
    for (var i = 0; i < models.length; i++) {
      var key = String(models[i].instanceId) + "\u001f" + String(models[i].model)
      if (key === value) return models[i].modelOptions || []
    }
    return []
  }

  function resetSelectedModelOptions() {
    var descriptors = descriptorsForModel(selectedModel)
    var result = []
    for (var i = 0; i < descriptors.length; i++) {
      var descriptor = descriptors[i]
      result.push({
        id: String(descriptor.id),
        label: String(descriptor.label || ""),
        description: descriptor.description || "",
        currentValue: String(descriptor.currentValue || ""),
        choices: descriptor.choices || []
      })
    }
    selectedModelOptions = result
    selectedModelOptionsFor = selectedModel
  }

  function selectModel(value) {
    selectedModel = value
    resetSelectedModelOptions()
  }

  function selectModelOption(optionId, value) {
    var descriptors = selectedModelOptions || []
    var result = []
    for (var i = 0; i < descriptors.length; i++) {
      var descriptor = descriptors[i]
      result.push({
        id: String(descriptor.id),
        label: String(descriptor.label || ""),
        description: descriptor.description || "",
        currentValue: String(descriptor.id) === optionId ? value : String(descriptor.currentValue || ""),
        choices: descriptor.choices || []
      })
    }
    selectedModelOptions = result
  }

  function selectedOptionValues() {
    var descriptors = selectedModelOptions || []
    var result = []
    for (var i = 0; i < descriptors.length; i++) {
      if (descriptors[i].currentValue)
        result.push({ id: String(descriptors[i].id), value: String(descriptors[i].currentValue) })
    }
    return result
  }

  function runtimeModeLabel(value) {
    if (value === "auto-accept-edits") return "Auto-accept edits"
    if (value === "auto") return "Auto"
    if (value === "full-access") return "Full access"
    return "Ask first"
  }

  function runtimeModeWarning(value) {
    if (value === "auto-accept-edits")
      return "File edits will be approved automatically; other actions still ask."
    if (value === "auto")
      return "Supported providers may approve routine actions automatically."
    if (value === "full-access")
      return "Commands and file changes can run without approval prompts."
    return "Commands and file changes require approval."
  }

  function resetNewTaskAccess() {
    selectedRuntimeMode = "approval-required"
    pendingRuntimeMode = ""
  }

  function requestRuntimeMode(value) {
    if (value === "approval-required") {
      resetNewTaskAccess()
      return
    }
    if (value === selectedRuntimeMode) {
      pendingRuntimeMode = ""
      return
    }
    pendingRuntimeMode = value
  }

  function confirmBroaderRuntimeMode() {
    if (!pendingRuntimeMode) return
    selectedRuntimeMode = pendingRuntimeMode
    pendingRuntimeMode = ""
  }

  function ensureDefaults() {
    var projects = projectOptions()
    if (!selectedProject && projects.length > 0) selectedProject = projects[0].value
    var models = root.service.models || []
    if (!selectedModel) {
      for (var i = 0; i < models.length; i++) if (models[i].available && models[i].isDefault) {
        selectedModel = String(models[i].instanceId) + "\u001f" + String(models[i].model)
        break
      }
      var availableModels = modelOptions()
      if (!selectedModel && availableModels.length > 0) selectedModel = availableModels[0].value
    }
    if (selectedModelOptionsFor !== selectedModel) resetSelectedModelOptions()
  }

  function submitNewThread() {
    var prompt = newPrompt.text.trim()
    if (!prompt || !selectedProject || pendingRuntimeMode) return
    var split = selectedModel.split("\u001f")
    root.service.createThread(
      selectedProject,
      prompt,
      "",
      split[0] || "",
      split[1] || "",
      selectedOptionValues(),
      selectedRuntimeMode)
    newPrompt.text = ""
    creating = false
    resetNewTaskAccess()
  }

  function pin(threadId, pinned) { pinned ? root.service.unpin(threadId) : root.service.pin(threadId) }
  function settle(threadId, settled) { settled ? root.service.unsettle(threadId) : root.service.settle(threadId) }
  function snooze(threadId, snoozed) {
    if (snoozed) root.service.unsnooze(threadId)
    else root.service.snooze(threadId, new Date(Date.now() + 86400000).toISOString())
  }

  Connections {
    target: root.service
    function onModelsChanged() {
      root.ensureDefaults()
      root.resetSelectedModelOptions()
    }
    function onInboxChanged() { root.ensureDefaults() }
    function onConnectionPhaseChanged() {
      if (root.service.connectionPhase !== "connected") {
        root.creating = false
        root.resetNewTaskAccess()
      }
    }
  }

  Component.onCompleted: {
    ensureDefaults()
    if (root.service.connectionPhase === "connected") root.service.refreshInbox()
  }

  Column {
    anchors.fill: parent
    spacing: Style.spacing.panelGap

    Row {
      width: parent.width
      spacing: Style.spacing.md

      T3Mark {
        width: Style.space(32)
        height: Style.space(20)
        anchors.verticalCenter: parent.verticalCenter
        markColor: Color.foreground
      }
      Text {
        width: parent.width - controls.implicitWidth - Style.space(32) - parent.spacing * 2
        anchors.verticalCenter: parent.verticalCenter
        text: "Inbox"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.heading
        font.bold: true
      }
      Row {
        id: controls
        spacing: Style.spacing.xs
        Button {
          iconText: "󰑐"
          tooltipText: root.service.connectionPhase === "connected" ? "Refresh Inbox" : "Retry connection"
          onClicked: root.service.refreshConnection()
        }
        Button { iconText: "󰍃"; tooltipText: "Sign out"; onClicked: root.service.logout() }
        Button { iconText: "󰅖"; tooltipText: "Close"; onClicked: root.closeRequested() }
      }
    }

    Dropdown {
      visible: root.service.environments && root.service.environments.length > 0
      width: parent.width
      showLabel: false
      options: root.environmentOptions()
      value: root.service.selectedEnvironmentId
      onChanged: function(value) { root.service.selectEnvironment(value) }
    }

    BorderSurface {
      visible: root.service.remoteAccess === "blockedByUpstream" || root.service.connectionPhase === "blocked"
      width: parent.width
      height: blockerText.implicitHeight + Style.spacing.rowPaddingX * 2
      color: Util.alpha(Color.urgent, 0.11)
      borderSpec: Border.controlSpec("normal", Color.urgent, Color.urgent)
      radius: Style.cornerRadius
      Text {
        id: blockerText
        anchors.fill: parent
        anchors.margins: Style.spacing.rowPaddingX
        text: root.service.connectionDetail || root.service.authDetail || "The selected environment cannot be authorized by this OAuth client."
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        wrapMode: Text.WordWrap
      }
    }

    Row {
      width: parent.width
      spacing: Style.spacing.md
      Text {
        width: parent.width - (newButton.visible ? newButton.implicitWidth + parent.spacing : 0)
        text: root.service.connectionPhase === "connected"
          ? "Connected" + (root.formattedInboxUpdatedAt ? " · updated " + root.formattedInboxUpdatedAt : "")
          : (root.service.connectionPhase === "blocked"
            ? "Connection blocked"
          : String(root.service.connectionPhase) + (root.service.connectionDetail ? " · " + root.service.connectionDetail : "")
          )
        color: root.service.connectionPhase === "error" || root.service.connectionPhase === "blocked" ? Color.urgent : Color.muted
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        elide: Text.ElideRight
        anchors.verticalCenter: parent.verticalCenter
      }
      Button {
        id: newButton
        iconText: root.creating ? "󰅖" : "󰐕"
        text: root.creating ? "Cancel" : "New task"
        visible: root.service.connectionPhase === "connected"
        enabled: root.service.connectionPhase === "connected"
        active: enabled && !root.creating
        onClicked: {
          root.creating = !root.creating
          root.resetNewTaskAccess()
          if (root.creating) Qt.callLater(function() { newPrompt.forceActiveFocus() })
        }
      }
    }

    BorderSurface {
      visible: root.creating && root.service.connectionPhase === "connected"
      width: parent.width
      height: createColumn.implicitHeight + Style.spacing.rowPaddingX * 2
      radius: Style.cornerRadius
      color: Util.alpha(Color.foreground, 0.035)
      borderSpec: Border.controlSpec("normal", Color.foreground, Color.accent)

      Column {
        id: createColumn
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        anchors.margins: Style.spacing.rowPaddingX
        spacing: Style.spacing.md

        Dropdown { width: parent.width; label: "Project"; options: root.projectOptions(); value: root.selectedProject; onChanged: function(value) { root.selectedProject = value } }
        TextArea {
          id: newPrompt
          width: parent.width
          height: Style.space(86)
          placeholderText: "What should T3 work on?"
          color: Color.foreground
          placeholderTextColor: Color.muted
          selectionColor: Util.alpha(Color.accent, 0.4)
          selectedTextColor: Color.foreground
          font.family: Style.font.family
          font.pixelSize: Style.font.body
          wrapMode: TextEdit.Wrap
          padding: Style.spacing.controlPaddingX
          background: BorderSurface {
            color: Style.normalFillFor(Color.foreground, Color.accent)
            borderSpec: Border.controlSpec("normal", Color.foreground, Color.accent)
            radius: Style.cornerRadius
          }
          Keys.onPressed: function(event) {
            if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && !(event.modifiers & Qt.ShiftModifier)) {
              root.submitNewThread()
              event.accepted = true
            }
          }
        }

        Row {
          id: createActionRow
          width: parent.width
          spacing: Style.spacing.sm
          readonly property int gapCount: 4
          readonly property real selectorCapacity: Math.max(0, width - createSendButton.width - spacing * gapCount)
          readonly property real selectorWidth: Math.min(selectorCapacity, Style.space(315))

          ModelDropdown {
            id: createModelDropdown
            width: createActionRow.selectorWidth * 0.36
            rowHeight: Style.space(24)
            triggerFontSize: Style.font.caption
            options: root.modelOptions()
            value: root.selectedModel
            onChanged: function(value) { root.selectModel(value) }
          }
          ModelOptionsPicker {
            id: createModelOptionsPicker
            width: createActionRow.selectorWidth * 0.30
            rowHeight: Style.space(24)
            triggerFontSize: Style.font.caption
            descriptors: root.selectedModelOptions
            onChanged: function(optionId, value) { root.selectModelOption(optionId, value) }
          }
          ModelDropdown {
            id: createRuntimeDropdown
            width: createActionRow.selectorWidth - createModelDropdown.width - createModelOptionsPicker.width
            rowHeight: Style.space(24)
            triggerFontSize: Style.font.caption
            showProviderColumn: false
            options: [
              { value: "approval-required", label: "Ask first" },
              { value: "auto-accept-edits", label: "Auto edits" },
              { value: "auto", label: "Auto" },
              { value: "full-access", label: "Full access" }
            ]
            value: root.selectedRuntimeMode
            onChanged: function(value) { root.requestRuntimeMode(value) }
          }
          Item {
            width: Math.max(0, createActionRow.selectorCapacity - createActionRow.selectorWidth)
            height: 1
          }
          Button {
            id: createSendButton
            width: Style.space(32)
            height: Style.space(24)
            iconText: "󰒊"
            tooltipText: root.selectedRuntimeMode === "approval-required"
              ? "Create with approval prompts"
              : "Create with " + root.runtimeModeLabel(root.selectedRuntimeMode)
            active: true
            enabled: newPrompt.text.trim().length > 0
              && root.selectedProject.length > 0
              && root.pendingRuntimeMode.length === 0
            horizontalPadding: Style.spacing.sm
            verticalPadding: Style.spacing.sm
            onClicked: root.submitNewThread()
          }
        }

        BorderSurface {
          visible: root.pendingRuntimeMode.length > 0 || root.selectedRuntimeMode !== "approval-required"
          width: parent.width
          height: runtimeAccessColumn.implicitHeight + Style.spacing.sm * 2
          radius: Style.cornerRadius
          color: Util.alpha(Color.urgent, 0.10)
          borderSpec: Border.controlSpec("normal", Color.urgent, Color.urgent)

          Column {
            id: runtimeAccessColumn
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.margins: Style.spacing.sm
            spacing: Style.spacing.sm

            Text {
              width: parent.width
              text: root.pendingRuntimeMode.length > 0
                ? "Enable " + root.runtimeModeLabel(root.pendingRuntimeMode) + " for this task? "
                  + root.runtimeModeWarning(root.pendingRuntimeMode)
                : root.runtimeModeLabel(root.selectedRuntimeMode) + " is enabled for this task. "
                  + root.runtimeModeWarning(root.selectedRuntimeMode)
              color: Color.foreground
              font.family: Style.font.family
              font.pixelSize: Style.font.caption
              wrapMode: Text.WordWrap
            }

            Row {
              visible: root.pendingRuntimeMode.length > 0
              spacing: Style.spacing.sm
              Button {
                text: "Keep Ask first"
                onClicked: root.resetNewTaskAccess()
              }
              Button {
                text: "Enable " + root.runtimeModeLabel(root.pendingRuntimeMode)
                foreground: Color.urgent
                onClicked: root.confirmBroaderRuntimeMode()
              }
            }

            Button {
              visible: root.pendingRuntimeMode.length === 0
              text: "Return to Ask first"
              onClicked: root.resetNewTaskAccess()
            }
          }
        }
      }
    }

    ScrollView {
      id: inboxScroll
      width: parent.width
      height: parent.height - y
      clip: true
      ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

      Column {
        width: inboxScroll.availableWidth
        spacing: Style.spacing.panelGap

        InboxSection {
          title: "PINNED"
          items: root.service.inbox.pinned || []
          onThreadActivated: function(threadId) { root.service.openThread(threadId) }
          onPinRequested: function(threadId, pinned) { root.pin(threadId, pinned) }
          onSettleRequested: function(threadId, settled) { root.settle(threadId, settled) }
          onSnoozeRequested: function(threadId, snoozed) { root.snooze(threadId, snoozed) }
        }
        InboxSection {
          title: "INBOX / ACTIVE"
          items: root.service.inbox.active || []
          onThreadActivated: function(threadId) { root.service.openThread(threadId) }
          onPinRequested: function(threadId, pinned) { root.pin(threadId, pinned) }
          onSettleRequested: function(threadId, settled) { root.settle(threadId, settled) }
          onSnoozeRequested: function(threadId, snoozed) { root.snooze(threadId, snoozed) }
        }
        InboxSection {
          title: "SNOOZED"
          items: root.service.inbox.snoozed || []
          initiallyExpanded: false
          onThreadActivated: function(threadId) { root.service.openThread(threadId) }
          onPinRequested: function(threadId, pinned) { root.pin(threadId, pinned) }
          onSettleRequested: function(threadId, settled) { root.settle(threadId, settled) }
          onSnoozeRequested: function(threadId, snoozed) { root.snooze(threadId, snoozed) }
        }
        InboxSection {
          title: "SETTLED"
          items: root.service.inbox.settled || []
          initiallyExpanded: false
          onThreadActivated: function(threadId) { root.service.openThread(threadId) }
          onPinRequested: function(threadId, pinned) { root.pin(threadId, pinned) }
          onSettleRequested: function(threadId, settled) { root.settle(threadId, settled) }
          onSnoozeRequested: function(threadId, snoozed) { root.snooze(threadId, snoozed) }
        }

        Text {
          visible: (root.service.inbox.pinned || []).length + (root.service.inbox.active || []).length + (root.service.inbox.snoozed || []).length + (root.service.inbox.settled || []).length === 0
            && root.service.connectionPhase === "connected"
          width: parent.width
          topPadding: Style.spacing.huge
          text: "Your T3 Inbox is clear."
          color: Color.muted
          font.family: Style.font.family
          font.pixelSize: Style.font.body
          horizontalAlignment: Text.AlignHCenter
        }
      }
    }
  }
}
