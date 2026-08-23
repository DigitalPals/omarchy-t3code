import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  property var shell: null
  property var manifest: null
  property bool ready: false
  property bool stopping: false
  property string authPhase: "signedOut"
  property string identity: ""
  property string remoteAccess: "unknown"
  property string authDetail: ""
  property string connectionPhase: "disconnected"
  property string connectionDetail: ""
  property var environments: []
  property string selectedEnvironmentId: ""
  property string inboxScopeId: ""
  property bool allComputersActive: false
  property bool allComputersOpening: false
  property var inbox: ({ pinned: [], active: [], snoozed: [], settled: [], projects: [], models: [] })
  property var thread: null
  property var models: []
  property string lastError: ""
  property string openThreadId: ""
  property string openThreadEnvironmentId: ""
  property bool openingThread: false
  property bool threadSubscriptionActive: false
  property int requestSerial: 0
  property var callbacks: ({})
  property var queuedWrites: []
  property string allComputersEnvironmentId: ""

  signal authCompleted()
  signal navigateThread(string threadId)
  signal navigateInbox()

  readonly property string pluginDir: manifest && manifest.__sourceDir ? String(manifest.__sourceDir) : ""
  readonly property string bridgePath: pluginDir + "/bin/t3-mini-bridge"
  readonly property bool allComputersAvailable: allComputersEnvironmentId.length > 0 && environments.length > 2
  readonly property bool showingAllComputers: allComputersEnvironmentId.length > 0
    && inboxScopeId === allComputersEnvironmentId
  readonly property int attentionCount: countAttention()

  function countAttention() {
    var count = 0
    var groups = [inbox.pinned || [], inbox.active || [], inbox.snoozed || []]
    for (var g = 0; g < groups.length; g++)
      for (var i = 0; i < groups[g].length; i++) if (groups[g][i].attention) count++
    return count
  }

  function nextRequestId() {
    requestSerial += 1
    return "qml-" + Date.now() + "-" + requestSerial
  }

  function request(type, payload, callback) {
    var requestId = nextRequestId()
    if (callback) {
      var next = {}
      for (var key in callbacks) next[key] = callbacks[key]
      next[requestId] = callback
      callbacks = next
    }
    var line = JSON.stringify({ protocolVersion: 1, requestId: requestId, type: type, payload: payload || {} }) + "\n"
    if (bridge.running && ready) bridge.write(line)
    else queuedWrites = queuedWrites.concat([line])
    return requestId
  }

  function flushWrites() {
    var writes = queuedWrites
    queuedWrites = []
    for (var i = 0; i < writes.length; i++) bridge.write(writes[i])
  }

  function failPendingRequests() {
    var pending = callbacks
    callbacks = ({})
    queuedWrites = []
    allComputersActive = false
    allComputersOpening = false
    for (var key in pending)
      pending[key](false, { code: "BRIDGE_RESTARTED", message: "The T3 bridge restarted; live state will be restored automatically.", retryable: true })
  }

  function resumeOpenThread() {
    if (!openThreadId || !openThreadEnvironmentId || openingThread || threadSubscriptionActive || connectionPhase !== "connected") return
    openingThread = true
    request("thread.open", { environmentId: openThreadEnvironmentId, threadId: openThreadId }, function(ok, result) {
      if (ok) {
        models = result.models || models
        return
      }
      openingThread = false
      lastError = String(result && result.message ? result.message : "The thread could not be opened.")
      openThreadId = ""
      openThreadEnvironmentId = ""
      threadSubscriptionActive = false
      thread = null
      navigateInbox()
    })
  }

  function handleResponse(message) {
    var callback = callbacks[message.requestId]
    if (callback) {
      var next = {}
      for (var key in callbacks) if (key !== message.requestId) next[key] = callbacks[key]
      callbacks = next
      callback(message.ok === true, message.ok === true ? message.payload : message.error)
    }
    if (message.ok !== true && message.error) lastError = String(message.error.message || "T3 request failed")
  }

  function handleEvent(message) {
    var payload = message.payload || {}
    switch (message.event) {
      case "bridge.ready":
        allComputersEnvironmentId = String(payload.allComputersEnvironmentId || "")
        ready = true
        flushWrites()
        break
      case "auth.changed":
        authPhase = String(payload.phase || "signedOut")
        identity = String(payload.identity || "")
        remoteAccess = String(payload.remoteAccess || "unknown")
        authDetail = String(payload.detail || "")
        if (authPhase === "signedOut") {
          openThreadId = ""
          openThreadEnvironmentId = ""
          inboxScopeId = ""
          allComputersActive = false
          allComputersOpening = false
          openingThread = false
          threadSubscriptionActive = false
          thread = null
        }
        break
      case "auth.completed":
        authPhase = String(payload.phase || "signedIn")
        identity = String(payload.identity || "")
        remoteAccess = String(payload.remoteAccess || "unknown")
        authDetail = String(payload.detail || "")
        authCompleted()
        if (shell && typeof shell.summon === "function")
          shell.summon("io.github.digitalpals.omarchy-t3code", JSON.stringify({ route: "inbox" }))
        break
      case "connection.changed":
        connectionPhase = String(payload.phase || "disconnected")
        connectionDetail = String(payload.detail || "")
        selectedEnvironmentId = String(payload.environmentId || selectedEnvironmentId)
        if (!inboxScopeId) inboxScopeId = selectedEnvironmentId
        if (connectionPhase !== "connected") {
          openingThread = false
          threadSubscriptionActive = false
        }
        if (connectionPhase === "connected") restoreAllComputers()
        break
      case "environment.changed":
        environments = payload.environments || []
        selectedEnvironmentId = String(payload.selected || "")
        if (!inboxScopeId) inboxScopeId = selectedEnvironmentId
        if (showingAllComputers && !allComputersAvailable) {
          if (selectedEnvironmentId) selectInboxScope(selectedEnvironmentId)
          else {
            inboxScopeId = ""
            allComputersActive = false
            allComputersOpening = false
          }
        }
        restoreAllComputers()
        break
      case "inbox.changed":
        if (!inboxScopeId || String(payload.environmentId || "") !== inboxScopeId) break
        inbox = payload
        models = payload.models || []
        if (String(payload.environmentId || "") === allComputersEnvironmentId) allComputersActive = true
        resumeOpenThread()
        break
      case "thread.snapshot":
        if (!payload.id || String(payload.id) !== openThreadId
            || String(payload.environmentId || "") !== openThreadEnvironmentId) break
        thread = payload
        openingThread = false
        threadSubscriptionActive = true
        break
      case "error":
        lastError = String(payload.message || "T3 bridge error")
        break
    }
  }

  function handleLine(line) {
    var message
    try { message = JSON.parse(String(line)) }
    catch (error) { lastError = "The T3 bridge returned malformed data."; return }
    if (!message || message.protocolVersion !== 1) return
    if (message.type === "response") handleResponse(message)
    else if (message.type === "event") handleEvent(message)
  }

  function startLogin() { request("auth.login", {}) }
  function logout() { request("auth.logout", {}, function() { navigateInbox() }) }
  function refreshEnvironments() { request("environment.list", {}) }
  function restoreAllComputers() {
    if (!showingAllComputers || allComputersActive || allComputersOpening
        || !allComputersAvailable || connectionPhase !== "connected") return
    selectInboxScope(allComputersEnvironmentId)
  }
  function selectInboxScope(environmentId) {
    var requested = String(environmentId)
    if (requested === allComputersEnvironmentId && !allComputersAvailable) return
    inboxScopeId = requested
    if (requested === allComputersEnvironmentId) {
      allComputersOpening = true
      allComputersActive = false
    } else {
      allComputersOpening = false
      allComputersActive = false
    }
    request("environment.select", { environmentId: requested }, function(ok, result) {
      allComputersOpening = false
      if (!ok) {
        inboxScopeId = selectedEnvironmentId
        allComputersActive = false
        return
      }
      inboxScopeId = String(result.selected || requested)
      allComputersActive = inboxScopeId === allComputersEnvironmentId
      if (result.inbox) {
        inbox = result.inbox
        models = result.inbox.models || []
      }
      resumeOpenThread()
    })
  }
  function refreshInbox() {
    if (showingAllComputers) {
      allComputersActive = false
      selectInboxScope(allComputersEnvironmentId)
      return
    }
    request("inbox.get", {}, function(ok, payload) { if (ok) { inbox = payload; models = payload.models || [] } })
  }
  function refreshConnection() {
    if (showingAllComputers && connectionPhase === "connected") {
      refreshInbox()
      return
    }
    if (connectionPhase === "connected") {
      refreshInbox()
      return
    }
    if (selectedEnvironmentId) {
      selectInboxScope(selectedEnvironmentId)
      return
    }
    refreshEnvironments()
  }
  function openThread(environmentId, threadId) {
    thread = null
    openThreadId = String(threadId)
    openThreadEnvironmentId = String(environmentId)
    openingThread = false
    threadSubscriptionActive = false
    navigateThread(threadId)
    resumeOpenThread()
  }
  function closeThread() {
    openThreadId = ""
    openThreadEnvironmentId = ""
    openingThread = false
    threadSubscriptionActive = false
    request("thread.close", {})
    thread = null
    navigateInbox()
  }
  function createThread(projectId, prompt, title, providerInstanceId, model, modelOptions, runtimeMode) {
    var payload = { projectId: projectId, prompt: prompt }
    if (title) payload.title = title
    if (providerInstanceId && model) { payload.providerInstanceId = providerInstanceId; payload.model = model }
    if (modelOptions && modelOptions.length > 0) payload.modelOptions = modelOptions
    if (runtimeMode) payload.runtimeMode = runtimeMode
    request("thread.create", payload, function(ok, result) {
      if (ok && result && result.threadId) openThread(selectedEnvironmentId, String(result.threadId))
    })
  }
  function pasteScreenshot(environmentId, threadId, callback) {
    request("attachment.clipboard.read", { environmentId: environmentId, threadId: threadId }, callback)
  }
  function discardAttachment(environmentId, threadId, attachmentId) {
    request("attachment.discard", { environmentId: environmentId, threadId: threadId, attachmentId: attachmentId })
  }
  function send(environmentId, threadId, text, attachmentIds, callback) {
    var payload = { environmentId: environmentId, threadId: threadId, text: text }
    if (attachmentIds && attachmentIds.length > 0) payload.attachmentIds = attachmentIds
    request("thread.send", payload, callback)
  }
  function interrupt(environmentId, threadId) { request("thread.interrupt", { environmentId: environmentId, threadId: threadId }) }
  function settle(environmentId, threadId) { request("thread.settle", { environmentId: environmentId, threadId: threadId }) }
  function unsettle(environmentId, threadId) { request("thread.unsettle", { environmentId: environmentId, threadId: threadId }) }
  function snooze(environmentId, threadId, until) { request("thread.snooze", { environmentId: environmentId, threadId: threadId, until: until }) }
  function unsnooze(environmentId, threadId) { request("thread.unsnooze", { environmentId: environmentId, threadId: threadId }) }
  function pin(environmentId, threadId) { request("thread.pin", { environmentId: environmentId, threadId: threadId }) }
  function unpin(environmentId, threadId) { request("thread.unpin", { environmentId: environmentId, threadId: threadId }) }
  function setModel(environmentId, threadId, providerInstanceId, model) {
    request("thread.model.set", { environmentId: environmentId, threadId: threadId, providerInstanceId: providerInstanceId, model: model })
  }
  function setModelOption(environmentId, threadId, optionId, value) {
    request("thread.model.option.set", { environmentId: environmentId, threadId: threadId, optionId: optionId, value: value })
  }
  function rename(environmentId, threadId, title) { request("thread.rename", { environmentId: environmentId, threadId: threadId, title: title }) }
  function regenerateTitle(environmentId, threadId) { request("thread.title.regenerate", { environmentId: environmentId, threadId: threadId }) }
  function setRuntime(environmentId, threadId, runtimeMode) {
    request("thread.runtime.set", { environmentId: environmentId, threadId: threadId, runtimeMode: runtimeMode })
  }
  function setInteraction(environmentId, threadId, interactionMode) {
    request("thread.interaction.set", { environmentId: environmentId, threadId: threadId, interactionMode: interactionMode })
  }
  function respondApproval(environmentId, threadId, requestId, decision) {
    request("approval.respond", { environmentId: environmentId, threadId: threadId, requestId: requestId, decision: decision })
  }
  function respondInput(environmentId, threadId, requestId, answers) {
    request("input.respond", { environmentId: environmentId, threadId: threadId, requestId: requestId, answers: answers })
  }

  Process {
    id: bridge
    // QProcess can report a packaged shell wrapper as missing when launched
    // directly during a plugin hot reload. Use the known interpreter while
    // keeping the wrapper responsible for selecting the standalone binary.
    command: ["/bin/sh", root.bridgePath]
    workingDirectory: root.pluginDir
    stdinEnabled: true
    onStarted: root.ready = false
    onExited: {
      root.ready = false
      root.connectionPhase = "disconnected"
      root.allComputersActive = false
      root.allComputersOpening = false
      root.openingThread = false
      root.threadSubscriptionActive = false
      root.failPendingRequests()
      if (!root.stopping) restartTimer.restart()
    }
    stdout: SplitParser { onRead: function(line) { root.handleLine(line) } }
    stderr: SplitParser { onRead: function(line) { root.lastError = "The T3 bridge reported an internal error." } }
  }

  Timer {
    id: restartTimer
    interval: 1500
    onTriggered: if (!root.stopping && !bridge.running) bridge.running = true
  }

  Component.onCompleted: bridge.running = true
  Component.onDestruction: {
    stopping = true
    if (bridge.running) bridge.signal(15)
  }
}
