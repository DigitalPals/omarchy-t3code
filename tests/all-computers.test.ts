import assert from "node:assert/strict";
import test from "node:test";
import type { PreparedConnection } from "@t3tools/client-runtime/connection";

import {
  ALL_COMPUTERS_ENVIRONMENT_ID,
  type CapabilitiesDto,
  type EnvironmentDto,
  type InboxDto,
  type ThreadSummaryDto,
} from "../bridge/src/protocol/types.ts";
import { AllComputersInbox, combineComputerInboxes } from "../bridge/src/t3/allComputers.ts";
import type { T3EnvironmentSession } from "../bridge/src/t3/session.ts";

const capabilities: CapabilitiesDto = {
  settlement: true,
  snooze: true,
  pinning: true,
  pinReorder: true,
  titleRegeneration: true,
  threadPagination: true,
};

function summary(
  environmentId: string,
  id: string,
  latestActivityAt: string,
  snoozedUntil: string | null = null,
): ThreadSummaryDto {
  return {
    environmentId,
    id,
    projectId: `project-${environmentId}`,
    project: `Project ${environmentId}`,
    title: `Thread ${id}`,
    provider: "codex",
    model: "gpt-5.6",
    phase: "ready",
    lifecycle: snoozedUntil === null ? "active" : "snoozed",
    updatedAt: latestActivityAt,
    latestActivityAt,
    attention: false,
    pinned: false,
    snoozedUntil,
    settled: false,
    canPin: true,
    canSettle: true,
    canSnooze: true,
  };
}

function inbox(
  environmentId: string,
  groups: Partial<Pick<InboxDto, "pinned" | "active" | "snoozed" | "settled">> = {},
  capabilityOverrides: Partial<CapabilitiesDto> = {},
): InboxDto {
  return {
    environmentId,
    updatedAt: `2026-08-23T00:00:0${environmentId.at(-1) ?? "0"}.000Z`,
    capabilities: { ...capabilities, ...capabilityOverrides },
    projects: [{ id: `project-${environmentId}`, title: `Project ${environmentId}` }],
    models: [],
    pinned: groups.pinned ?? [],
    active: groups.active ?? [],
    snoozed: groups.snoozed ?? [],
    settled: groups.settled ?? [],
  };
}

function environment(id: string): EnvironmentDto {
  return { id, label: `Computer ${id}`, status: "online", serverVersion: null, lastSeenAt: null };
}

test("combined Inbox keeps lifecycle groups and orders threads across computers", () => {
  const combined = combineComputerInboxes([
    inbox("computer-1", {
      active: [summary("computer-1", "older", "2026-08-23T10:00:00.000Z")],
      snoozed: [summary("computer-1", "later", "2026-08-23T08:00:00.000Z", "2026-08-25T00:00:00.000Z")],
    }),
    inbox("computer-2", {
      active: [summary("computer-2", "newer", "2026-08-23T12:00:00.000Z")],
      snoozed: [summary("computer-2", "sooner", "2026-08-23T09:00:00.000Z", "2026-08-24T00:00:00.000Z")],
    }, { pinning: false }),
  ]);

  assert.equal(combined.environmentId, ALL_COMPUTERS_ENVIRONMENT_ID);
  assert.deepEqual(combined.active.map((thread) => thread.id), ["newer", "older"]);
  assert.deepEqual(combined.snoozed.map((thread) => thread.id), ["sooner", "later"]);
  assert.equal(combined.capabilities.settlement, true);
  assert.equal(combined.capabilities.pinning, false);
  assert.deepEqual(combined.projects, []);
  assert.deepEqual(combined.models, []);
});

test("All computers connects the non-primary computers and routes their thread sessions", async () => {
  const prepared: string[] = [];
  const closed: string[] = [];
  const sessions = new Map<string, T3EnvironmentSession>();
  const closeCallbacks = new Map<string, (error: unknown) => void>();
  const published: InboxDto[] = [];
  const errors: Array<{ code: string }> = [];
  const manager = new AllComputersInbox({
    prepareConnection: async (environmentId) => {
      prepared.push(environmentId);
      return { environmentId } as PreparedConnection;
    },
  }, {
    createSession: (environmentId, onInbox, onClosed) => {
      const session = {
        connect: async () => {
          onInbox(inbox(environmentId, {
            active: [summary(environmentId, `thread-${environmentId}`, "2026-08-23T12:00:00.000Z")],
          }));
        },
        close: async () => { closed.push(environmentId); },
      } as unknown as T3EnvironmentSession;
      sessions.set(environmentId, session);
      closeCallbacks.set(environmentId, onClosed);
      return session;
    },
    onInbox: (value) => published.push(value),
    onError: (error) => errors.push(error),
  });
  const primarySession = {} as T3EnvironmentSession;

  const combined = await manager.activate(
    [environment("computer-1"), environment("computer-2"), environment("computer-3")],
    "computer-1",
    inbox("computer-1", {
      active: [summary("computer-1", "thread-computer-1", "2026-08-23T11:00:00.000Z")],
    }),
  );

  assert.deepEqual(prepared, ["computer-2", "computer-3"]);
  assert.deepEqual(combined.active.map((thread) => thread.environmentId), [
    "computer-2",
    "computer-3",
    "computer-1",
  ]);
  assert.equal(manager.sessionFor("computer-1", primarySession), primarySession);
  assert.equal(manager.sessionFor("computer-2", primarySession), sessions.get("computer-2"));
  assert.ok(published.length >= 3);

  closeCallbacks.get("computer-2")?.(new Error("offline"));
  await Promise.resolve();
  assert.deepEqual(manager.current().active.map((thread) => thread.environmentId), ["computer-3", "computer-1"]);
  assert.throws(
    () => manager.sessionFor("computer-2", primarySession),
    (error: unknown) => (error as { code?: string }).code === "ENVIRONMENT_NOT_CONNECTED",
  );
  assert.deepEqual(errors.map((error) => error.code), ["ENVIRONMENT_DISCONNECTED"]);

  await manager.deactivate();
  assert.deepEqual(closed.sort(), ["computer-2", "computer-3"]);
  assert.throws(() => manager.current(), /Select All computers first/u);
});

test("All computers stays unavailable for a single linked computer", async () => {
  const manager = new AllComputersInbox({
    prepareConnection: async () => assert.fail("No background connection should be prepared."),
  }, {
    createSession: () => assert.fail("No background session should be created."),
    onInbox: () => undefined,
    onError: () => undefined,
  });

  await assert.rejects(
    manager.activate([environment("computer-1")], "computer-1", inbox("computer-1")),
    (error: unknown) => (error as { code?: string }).code === "ALL_COMPUTERS_UNAVAILABLE",
  );
});

test("All computers activates when two computers are linked", async () => {
  const manager = new AllComputersInbox({
    prepareConnection: async (environmentId) => ({ environmentId }) as PreparedConnection,
  }, {
    createSession: (environmentId, onInbox) => ({
      connect: async () => onInbox(inbox(environmentId)),
      close: async () => undefined,
    }) as unknown as T3EnvironmentSession,
    onInbox: () => undefined,
    onError: () => assert.fail("The second computer should connect cleanly."),
  });

  const combined = await manager.activate(
    [environment("computer-1"), environment("computer-2")],
    "computer-1",
    inbox("computer-1"),
  );

  assert.equal(combined.environmentId, ALL_COMPUTERS_ENVIRONMENT_ID);
  await manager.deactivate();
});
