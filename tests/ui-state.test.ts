import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("UI state transitions Login → Inbox → Thread and back", async () => {
  const source = (await readFile(join(root, "plugin", "qml", "UiState.js"), "utf8"))
    .replace(".pragma library", "");
  const state = vm.runInNewContext(`${source}\n({ routeForOpen, routeAfterAuthentication })`) as {
    routeForOpen(auth: string, requested: string, hasThread: boolean): string;
    routeAfterAuthentication(auth: string): string;
  };
  assert.equal(state.routeForOpen("signedOut", "inbox", false), "login");
  assert.equal(state.routeForOpen("signingIn", "inbox", false), "login");
  assert.equal(state.routeAfterAuthentication("signedIn"), "inbox");
  assert.equal(state.routeForOpen("signedIn", "inbox", false), "inbox");
  assert.equal(state.routeForOpen("signedIn", "thread", true), "thread");
  assert.equal(state.routeAfterAuthentication("signedOut"), "login");
});

test("bar state summarizes server-projected thread and connection phases", async () => {
  const source = (await readFile(join(root, "plugin", "qml", "BarState.js"), "utf8"))
    .replace(".pragma library", "");
  const state = vm.runInNewContext(`${source}\n({ threadPhase, stateLabel })`) as {
    threadPhase(inbox: Record<string, unknown[]>): string;
    stateLabel(service: Record<string, unknown>): string;
  };
  const connected = {
    ready: true,
    authPhase: "signedIn",
    connectionPhase: "connected",
    inbox: { pinned: [], active: [], snoozed: [], settled: [] },
  };

  assert.equal(state.stateLabel(connected), "Idle");
  assert.equal(state.stateLabel({
    ...connected,
    inbox: { ...connected.inbox, active: [{ phase: "working" }] },
  }), "Working");
  assert.equal(state.threadPhase({
    pinned: [{ phase: "approvalNeeded" }],
    active: [{ phase: "working" }],
    snoozed: [{ phase: "inputNeeded" }],
  }), "inputNeeded");
  assert.equal(state.stateLabel({ ...connected, connectionPhase: "reconnecting" }), "Reconnecting");
  assert.equal(state.stateLabel({ ...connected, authPhase: "signedOut" }), "Signed out");
});

test("auth completion automatically summons the panel at Inbox", async () => {
  const service = await readFile(join(root, "plugin", "qml", "Service.qml"), "utf8");
  assert.match(service, /case "auth\.completed"[\s\S]*shell\.summon\("io\.github\.digitalpals\.omarchy-t3code", JSON\.stringify\(\{ route: "inbox" \}\)\)/u);
});

test("T3 mark preserves the upstream SVG winding fill", async () => {
  const mark = await readFile(join(root, "plugin", "qml", "T3Mark.qml"), "utf8");
  assert.match(mark, /fillRule: ShapePath\.WindingFill/u);
});

test("Inbox header omits login identity and presents a localized update time", async () => {
  const inbox = await readFile(join(root, "plugin", "qml", "InboxView.qml"), "utf8");
  assert.doesNotMatch(inbox, /root\.service\.identity|T3 Connect/u);
  assert.match(
    inbox,
    /function formatUpdatedAt\(value\)[\s\S]*new Date\([\s\S]*toLocaleString\(Qt\.locale\(\), Locale\.ShortFormat\)/u,
  );
  assert.match(inbox, /"Connected" \+ \(root\.formattedInboxUpdatedAt/u);
  assert.doesNotMatch(inbox, /String\(root\.service\.inbox\.updatedAt/u);
});

test("bridge restart preserves and resubscribes the active thread", async () => {
  const service = await readFile(join(root, "plugin", "qml", "Service.qml"), "utf8");
  assert.match(service, /property string openThreadId/u);
  assert.match(service, /case "inbox\.changed"[\s\S]*resumeOpenThread\(\)/u);
  assert.match(service, /onExited:[\s\S]*threadSubscriptionActive = false/u);
  assert.match(service, /request\("thread\.open", \{ threadId: openThreadId \}/u);
  assert.match(service, /function failPendingRequests\(\)[\s\S]*queuedWrites = \[\]/u);
  const openResponse = service.slice(service.indexOf("function resumeOpenThread"), service.indexOf("function handleResponse"));
  assert.doesNotMatch(openResponse, /threadSubscriptionActive = true/u);
  assert.match(service, /case "thread\.snapshot"[\s\S]*openingThread = false[\s\S]*threadSubscriptionActive = true/u);
});

test("assistant replies show changed files instead of raw tool activity", async () => {
  const threadView = await readFile(join(root, "plugin", "qml", "ThreadView.qml"), "utf8");
  const changedFiles = await readFile(join(root, "plugin", "qml", "ChangedFilesCard.qml"), "utf8");
  assert.match(threadView, /function diffForMessage\(messageId\)/u);
  assert.match(threadView, /function revealChangedFiles\(card\)[\s\S]*changedFilesRevealTimer\.restart\(\)/u);
  assert.match(threadView, /function positionChangedFiles\(\)[\s\S]*card\.mapToItem\(conversation\.contentItem\.contentItem[\s\S]*contentY/u);
  assert.match(threadView, /id: changedFilesRevealTimer[\s\S]*interval: 50[\s\S]*onTriggered: root\.positionChangedFiles\(\)/u);
  assert.match(threadView, /ChangedFilesCard\s*\{[\s\S]*summaryData: parent\.diffData[\s\S]*onRevealRequested: root\.revealChangedFiles\(changedFiles\)/u);
  assert.doesNotMatch(threadView, /threadData\.activities|ActivityRow|ActivityGroup/u);
  assert.match(changedFiles, /property bool expanded: false/u);
  assert.match(changedFiles, /readonly property var treeRows: buildTreeRows\(\)/u);
  assert.match(changedFiles, /if \(root\.expanded\) root\.revealRequested\(\)/u);
  assert.doesNotMatch(changedFiles, /Open diff|openDiffRequested/u);
  assert.doesNotMatch(threadView, /DiffView|selectedDiff/u);
});

test("thread view keeps only lifecycle actions and uses real pin glyphs", async () => {
  const threadView = await readFile(join(root, "plugin", "qml", "ThreadView.qml"), "utf8");
  const threadRow = await readFile(join(root, "plugin", "qml", "ThreadRow.qml"), "utf8");
  assert.doesNotMatch(threadView, /root\.service\.rename|root\.service\.regenerateTitle|titleField|\brenaming\b/u);
  assert.doesNotMatch(threadView, /tooltipText: "Rename"|Regenerate title/u);
  assert.match(threadView, /lifecycle === "pinned" \? "󰐃" : "󰤱"/u);
  assert.match(threadRow, /threadData\.pinned \? "󰐃" : "󰤱"/u);
  assert.doesNotMatch(threadView + threadRow, /󰐁/u);
});

test("working indicator follows pinned T3 elapsed-time formatting", async () => {
  const source = (await readFile(join(root, "plugin", "qml", "WorkingState.js"), "utf8"))
    .replace(".pragma library", "");
  const state = vm.runInNewContext(`${source}\n({ durationLabel, statusLabel })`) as {
    durationLabel(startIso: string, nowMs: number): string;
    statusLabel(phase: string, startIso: string, nowMs: number): string;
  };
  const startedAt = "2026-08-23T10:00:00.000Z";
  const startMs = Date.parse(startedAt);
  assert.equal(state.statusLabel("working", startedAt, startMs + 32_000), "Working for 32s");
  assert.equal(state.durationLabel(startedAt, startMs + 65_000), "1m 5s");
  assert.equal(state.durationLabel(startedAt, startMs + 3_720_000), "1h 2m");
  assert.equal(state.statusLabel("starting", "", startMs), "Working...");
  assert.equal(state.statusLabel("idle", startedAt, startMs + 32_000), "");

  const threadView = await readFile(join(root, "plugin", "qml", "ThreadView.qml"), "utf8");
  const indicator = await readFile(join(root, "plugin", "qml", "WorkingIndicator.qml"), "utf8");
  assert.match(threadView, /WorkingIndicator\s*\{[\s\S]*phase: root\.threadData[\s\S]*activeWorkStartedAt/u);
  assert.match(indicator, /Timer\s*\{[\s\S]*interval: 1000[\s\S]*running: root\.visible/u);
});

test("composer actions fit one row with compact labels", async () => {
  const composer = await readFile(join(root, "plugin", "qml", "Composer.qml"), "utf8");
  const modelDropdown = await readFile(join(root, "plugin", "qml", "ModelDropdown.qml"), "utf8");
  const modelOptions = await readFile(join(root, "plugin", "qml", "ModelOptionsPicker.qml"), "utf8");
  const compactLabelsSource = (await readFile(join(root, "plugin", "qml", "CompactLabels.js"), "utf8"))
    .replace(".pragma library", "");
  const compactLabels = vm.runInNewContext(`${compactLabelsSource}\n({ modelName })`) as {
    modelName(modelLabel: string, providerLabel: string): string;
  };
  assert.equal(compactLabels.modelName("Claude Fable 5", "Claude"), "Fable 5");
  assert.equal(compactLabels.modelName("GPT-5.6", "Codex"), "GPT-5.6");
  assert.match(composer, /providerLabel: String\(values\[i\]\.providerLabel\)[\s\S]*modelLabel: String\(values\[i\]\.label \|\| values\[i\]\.model\)/u);
  assert.match(composer, /Row\s*\{\s*id: actionRow[\s\S]*readonly property real selectorWidth/u);
  assert.doesNotMatch(composer, /Flow\s*\{/u);
  assert.match(composer, /id: sendButton[\s\S]*iconText: "󰒊"[\s\S]*tooltipText: "Send"/u);
  assert.match(composer, /id: sendButton[\s\S]*width: Style\.space\(32\)[\s\S]*height: Style\.space\(24\)/u);
  assert.match(composer, /selectorCapacity: Math\.max\(0, width - sendButton\.width/u);
  assert.doesNotMatch(composer, /text: "Send"|text: "Stop"/u);
  assert.ok(composer.indexOf("ModelDropdown") < composer.indexOf("ModelOptionsPicker"));
  assert.ok(composer.indexOf("ModelOptionsPicker") < composer.indexOf("id: runtimeDropdown"));
  assert.doesNotMatch(composer, /setInteraction|interactionMode|label: "Plan"/u);
  assert.match(composer, /selectorWidth: Math\.min\(selectorCapacity, Style\.space\(315\)\)/u);
  assert.match(composer, /id: modelDropdown[\s\S]*triggerFontSize: Style\.font\.caption[\s\S]*id: modelOptionsPicker[\s\S]*triggerFontSize: Style\.font\.caption[\s\S]*id: runtimeDropdown[\s\S]*triggerFontSize: Style\.font\.caption[\s\S]*showProviderColumn: false/u);
  assert.match(modelOptions, /descriptors[\s\S]*descriptorData\.label[\s\S]*descriptorData\.choices/u);
  assert.doesNotMatch(modelOptions, /labels\.join|" · "/u);
  assert.match(modelOptions, /text: "Default"/u);
  assert.match(modelDropdown, /function currentModelLabel\(\)[\s\S]*CompactLabels\.modelName\(optionModel\(options\[i\]\), optionProvider\(options\[i\]\)\)/u);
  assert.match(modelDropdown, /root\.showProviderColumn \? Style\.space\(420\) : Style\.space\(225\)/u);
  assert.match(modelDropdown, /text: root\.optionProvider\(optionRow\.modelData\)[\s\S]*text: root\.optionModel\(optionRow\.modelData\)/u);
  assert.match(modelOptions, /property real triggerFontSize: Style\.font\.body[\s\S]*font\.pixelSize: root\.triggerFontSize/u);
  assert.doesNotMatch(modelDropdown, /root\.value =/u);
  assert.match(composer, /readonly property string selectedModel/u);
  assert.doesNotMatch(composer, /root\.selectedModel =/u);
  assert.match(composer, /service\.send\(String\(threadData\.id\), value, attachmentIds/u);
});

test("assistant Markdown cannot request resources or open unsafe URL schemes", async () => {
  const source = (await readFile(join(root, "plugin", "qml", "MarkdownSafety.js"), "utf8"))
    .replace(".pragma library", "");
  const safety = vm.runInNewContext(`${source}\n({ safeMarkdown, isAllowedExternalUrl })`) as {
    safeMarkdown(value: string): string;
    isAllowedExternalUrl(value: string): boolean;
  };
  const rendered = safety.safeMarkdown([
    "![inline](https://tracker.example/image.png)",
    "![reference][remote]",
    "![collapsed][]",
    "![shortcut]",
    "<img src=https://tracker.example/pixel>",
    "<object data=https://tracker.example/file>",
    "<span style=\"background-image:url(https://tracker.example/bg)\">x</span>",
  ].join("\n"));
  assert.doesNotMatch(rendered, /!\[/u);
  assert.doesNotMatch(rendered, /</u);
  assert.match(rendered, /\[image: reference\]\[remote\]/u);
  assert.equal(safety.isAllowedExternalUrl("https://example.test/path"), true);
  assert.equal(safety.isAllowedExternalUrl(" HTTP://example.test/path"), true);
  assert.equal(safety.isAllowedExternalUrl("mailto:security@example.test"), true);
  for (const value of ["file:///etc/passwd", "data:text/html,test", "javascript:alert(1)", "t3code://app/"]) {
    assert.equal(safety.isAllowedExternalUrl(value), false);
  }
});

test("thread composer pastes, previews, removes, and sends clipboard screenshots", async () => {
  const composer = await readFile(join(root, "plugin", "qml", "Composer.qml"), "utf8");
  const service = await readFile(join(root, "plugin", "qml", "Service.qml"), "utf8");
  const message = await readFile(join(root, "plugin", "qml", "MessageBubble.qml"), "utf8");
  assert.match(composer, /function handlePasteShortcut\(event\)[\s\S]*StandardKey\.Paste[\s\S]*Quickshell\.clipboardText/u);
  assert.match(composer, /function pasteScreenshot\(\)[\s\S]*service\.pasteScreenshot/u);
  assert.match(composer, /Image\s*\{[\s\S]*modelData\.previewUrl/u);
  assert.match(composer, /function removeAttachment\(index\)[\s\S]*service\.discardAttachment/u);
  assert.match(composer, /service\.send\([\s\S]*attachmentIds, function\(ok, result\)/u);
  assert.match(composer, /prompt\.text\.trim\(\)\.length > 0 \|\| root\.attachments\.length > 0/u);
  assert.match(service, /request\("attachment\.clipboard\.read"/u);
  assert.match(service, /payload\.attachmentIds = attachmentIds/u);
  assert.match(message, /function attachmentSummary\(\)[\s\S]*\[image:/u);
});

test("new-thread composer mirrors model options and access controls from replies", async () => {
  const inbox = await readFile(join(root, "plugin", "qml", "InboxView.qml"), "utf8");
  const service = await readFile(join(root, "plugin", "qml", "Service.qml"), "utf8");
  assert.match(inbox, /function descriptorsForModel\(value\)[\s\S]*models\[i\]\.modelOptions/u);
  assert.match(inbox, /function selectedOptionValues\(\)[\s\S]*id:[\s\S]*value:/u);
  assert.match(inbox, /Row\s*\{\s*id: createActionRow[\s\S]*readonly property real selectorWidth/u);
  assert.match(inbox, /ModelDropdown\s*\{\s*id: createModelDropdown/u);
  assert.ok(inbox.indexOf("id: createModelDropdown") < inbox.indexOf("id: createModelOptionsPicker"));
  assert.ok(inbox.indexOf("id: createModelOptionsPicker") < inbox.indexOf("id: createRuntimeDropdown"));
  assert.match(inbox, /id: createModelOptionsPicker[\s\S]*descriptors: root\.selectedModelOptions/u);
  assert.match(inbox, /id: createRuntimeDropdown[\s\S]*triggerFontSize: Style\.font\.caption[\s\S]*showProviderColumn: false[\s\S]*value: root\.selectedRuntimeMode/u);
  assert.match(inbox, /selectedOptionValues\(\),[\s\S]*selectedRuntimeMode\)/u);
  assert.match(service, /function createThread\([^)]*modelOptions, runtimeMode\)[\s\S]*payload\.modelOptions = modelOptions[\s\S]*payload\.runtimeMode = runtimeMode/u);
});

test("live plugin startup uses a QProcess-safe launcher and waits for service injection", async () => {
  const service = await readFile(join(root, "plugin", "qml", "Service.qml"), "utf8");
  const panel = await readFile(join(root, "plugin", "qml", "Panel.qml"), "utf8");
  assert.match(service, /command: \["\/bin\/sh", root\.bridgePath\]/u);
  assert.match(panel, /active: root\.service !== null/u);
});

test("the mini client opens in the bar-owned Omarchy modal", async () => {
  const manifest = JSON.parse(await readFile(join(root, "plugin", "manifest.json"), "utf8")) as {
    kinds: string[];
    entryPoints: Record<string, string>;
  };
  const widget = await readFile(join(root, "plugin", "qml", "BarWidget.qml"), "utf8");
  const panel = await readFile(join(root, "plugin", "qml", "Panel.qml"), "utf8");

  assert.deepEqual(manifest.kinds, ["service", "bar-widget"]);
  assert.equal(manifest.entryPoints.panel, undefined);
  assert.match(widget, /Ui\.Panel\s*\{/u);
  assert.match(widget, /Ui\.WidgetButton\s*\{/u);
  assert.match(widget, /text: root\.stateText/u);
  assert.doesNotMatch(widget, /root\.connected \? "#61c98b"/u);
  assert.match(widget, /Ui\.KeyboardPanel\s*\{/u);
  assert.match(widget, /anchorItem: icon/u);
  assert.match(widget, /open: root\.opened/u);
  assert.match(widget, /service: root\.t3 \|\| null/u);
  assert.match(panel, /FocusScope\s*\{/u);
  assert.doesNotMatch(panel, /FloatingWindow/u);
});

test("packaging installs a callback handler that forwards URI arguments", async () => {
  const launcher = await readFile(join(root, "plugin", "bin", "t3-mini-bridge"), "utf8");
  const desktop = await readFile(
    join(root, "plugin", "share", "applications", "io.github.digitalpals.omarchy-t3code-callback.desktop.in"),
    "utf8",
  );
  const installer = await readFile(join(root, "scripts", "install-package"), "utf8");
  const sourceInstaller = await readFile(join(root, "scripts", "install-plugin.mjs"), "utf8");
  const uninstaller = await readFile(join(root, "scripts", "uninstall-package"), "utf8");
  assert.match(launcher, /exec "\$plugin_root\/lib\/t3-mini-bridge" "\$@"/u);
  assert.match(desktop, /^MimeType=x-scheme-handler\/t3code;$/mu);
  assert.match(desktop, /^Exec=@CALLBACK_EXEC@ --oauth-callback %u$/mu);
  assert.match(installer, /io\.github\.digitalpals\.omarchy-t3code-callback\.desktop/u);
  assert.match(installer, /update-desktop-database/u);
  assert.match(installer, /bar put "\$plugin_id" --section right --index 0/u);
  assert.match(sourceInstaller, /join\(root, "dist", "install"\)/u);
  assert.match(uninstaller, /--keep-secrets/u);
  assert.match(uninstaller, /relay-dpop-proof-key/u);
  assert.match(installer, /find "\$backup_root"[\s\S]*! -path "\$backup" -exec rm -r/u);
  assert.doesNotMatch(installer + sourceInstaller, /plugin[", ]+enable[", ]+["$]*\{?plugin_id|plugin[", ]+enable[", ]+id/u);
});

test("blocked Relay connection hides and disables task creation", async () => {
  const service = await readFile(join(root, "plugin", "qml", "Service.qml"), "utf8");
  const inbox = await readFile(join(root, "plugin", "qml", "InboxView.qml"), "utf8");
  assert.match(
    inbox,
    /id: newButton[\s\S]*visible: root\.service\.connectionPhase === "connected"[\s\S]*enabled: root\.service\.connectionPhase === "connected"/u,
  );
  assert.match(
    inbox,
    /visible: root\.creating && root\.service\.connectionPhase === "connected"/u,
  );
  assert.match(
    inbox,
    /onConnectionPhaseChanged\(\)[\s\S]*root\.creating = false/u,
  );
  assert.match(
    service,
    /function refreshConnection\(\)[\s\S]*connectionPhase === "connected"[\s\S]*refreshInbox\(\)[\s\S]*selectedEnvironmentId[\s\S]*selectEnvironment\(selectedEnvironmentId\)/u,
  );
  assert.match(
    inbox,
    /tooltipText: root\.service\.connectionPhase === "connected" \? "Refresh Inbox" : "Retry connection"[\s\S]*onClicked: root\.service\.refreshConnection\(\)/u,
  );
});
