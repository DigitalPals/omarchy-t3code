import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AuthProvider } from "../bridge/src/auth/provider.ts";
import { ConnectionCoordinator } from "../bridge/src/connection/coordinator.ts";
import { BridgeError } from "../bridge/src/security/redact.ts";
import type { T3RelayClient } from "../bridge/src/t3/relay.ts";
import type { T3EnvironmentSession } from "../bridge/src/t3/session.ts";

const auth = {} as AuthProvider;
const environment = { id: "environment-1", label: "Desktop", status: "linked", serverVersion: null, lastSeenAt: null };

test("retryable environment failures reconnect with backoff", async () => {
  const state = await mkdtemp(join(tmpdir(), "omarchy-t3-connect-"));
  const priorStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = state;
  let attempts = 0;
  const phases: string[] = [];
  const relay = {
    listEnvironments: async () => [environment],
    prepareConnection: async () => {
      attempts += 1;
      if (attempts === 1) throw new BridgeError("RELAY_UNAVAILABLE", "Relay offline.", true);
      return { environmentId: environment.id };
    },
  } as unknown as T3RelayClient;
  const session = {
    connect: async () => ({ environment: { serverVersion: "0.0.34" } }),
    close: async () => undefined,
  } as unknown as T3EnvironmentSession;
  const coordinator = new ConnectionCoordinator(auth, relay, session, {
    onConnection: (status) => phases.push(status.phase),
    onEnvironment: () => undefined,
    onError: () => undefined,
  });
  try {
    await coordinator.discover();
    await assert.rejects(coordinator.select(environment.id), /Relay offline/u);
    await new Promise((resolve) => setTimeout(resolve, 1_250));
    assert.equal(attempts, 2);
    assert.equal(coordinator.status().phase, "connected");
    assert(phases.includes("reconnecting"));
    await coordinator.disconnect();
  } finally {
    if (priorStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = priorStateHome;
    await rm(state, { recursive: true, force: true });
  }
});

test("known OAuth/DPoP restriction blocks without retrying", async () => {
  const state = await mkdtemp(join(tmpdir(), "omarchy-t3-blocked-"));
  const priorStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = state;
  let attempts = 0;
  const relay = {
    listEnvironments: async () => [environment],
    prepareConnection: async () => {
      attempts += 1;
      throw new BridgeError("UPSTREAM_OAUTH_DPOP_UNSUPPORTED", "OAuth is not accepted for DPoP.", false);
    },
  } as unknown as T3RelayClient;
  const session = { close: async () => undefined } as unknown as T3EnvironmentSession;
  const coordinator = new ConnectionCoordinator(auth, relay, session, {
    onConnection: () => undefined,
    onEnvironment: () => undefined,
    onError: () => undefined,
  });
  try {
    await coordinator.discover();
    await assert.rejects(coordinator.select(environment.id));
    assert.equal(coordinator.status().phase, "blocked");
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    assert.equal(attempts, 1);
    await coordinator.disconnect();
  } finally {
    if (priorStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = priorStateHome;
    await rm(state, { recursive: true, force: true });
  }
});

test("refreshing discovery preserves an active environment session", async () => {
  const state = await mkdtemp(join(tmpdir(), "omarchy-t3-refresh-"));
  const priorStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = state;
  let connections = 0;
  const relay = {
    listEnvironments: async () => [environment],
    prepareConnection: async () => ({ environmentId: environment.id }),
  } as unknown as T3RelayClient;
  const session = {
    connect: async () => {
      connections += 1;
      return { environment: { serverVersion: "0.0.34" } };
    },
    close: async () => undefined,
  } as unknown as T3EnvironmentSession;
  const coordinator = new ConnectionCoordinator(auth, relay, session, {
    onConnection: () => undefined,
    onEnvironment: () => undefined,
    onError: () => undefined,
  });
  try {
    await coordinator.discover();
    await coordinator.select(environment.id);
    await coordinator.discover();
    assert.equal(coordinator.status().phase, "connected");
    await coordinator.select(environment.id);
    assert.equal(connections, 1);
    await coordinator.disconnect();
  } finally {
    if (priorStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = priorStateHome;
    await rm(state, { recursive: true, force: true });
  }
});
