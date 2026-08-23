import { clerkFrontendApiUrlFromPublishableKey } from "@t3tools/shared/relayAuth";

import { NativeClerkProvider } from "./auth/nativeProvider.ts";
import { ConnectionCoordinator } from "./connection/coordinator.ts";
import { NdjsonChannel, type NdjsonHandler } from "./ipc/ndjson.ts";
import { event, failure, success } from "./protocol/output.ts";
import {
  ALL_COMPUTERS_ENVIRONMENT_ID,
  PROTOCOL_VERSION,
  type BridgeRequest,
  type InboxDto,
} from "./protocol/types.ts";
import { asBridgeError, BridgeError } from "./security/redact.ts";
import { MemorySecretStore, SecretServiceStore } from "./security/secretStore.ts";
import { AllComputersInbox } from "./t3/allComputers.ts";
import { T3Commands } from "./t3/commands.ts";
import { DpopKeyManager } from "./t3/dpop.ts";
import { T3RelayClient } from "./t3/relay.ts";
import { T3EnvironmentSession } from "./t3/session.ts";
import packageMetadata from "../../package.json" with { type: "json" };
import upstreamLock from "../../t3-upstream.lock.json" with { type: "json" };

const UPSTREAM = upstreamLock;

export class BridgeApp implements NdjsonHandler {
  readonly channel: NdjsonChannel;
  private readonly auth: NativeClerkProvider;
  private readonly connection: ConnectionCoordinator;
  private readonly allComputers: AllComputersInbox;
  private readonly commands: T3Commands;
  private openThreadSession: T3EnvironmentSession | null = null;
  private login: Promise<void> | null = null;
  private shuttingDown = false;

  constructor() {
    this.channel = new NdjsonChannel(this);
    const secrets = process.env.NODE_ENV === "test" && process.env.T3_MINI_TEST_MEMORY_SECRETS === "1"
      ? new MemorySecretStore()
      : new SecretServiceStore();
    const configuredClerkUrl = process.env.T3CODE_CLERK_URL
      ?? (process.env.T3CODE_CLERK_PUBLISHABLE_KEY
        ? clerkFrontendApiUrlFromPublishableKey(process.env.T3CODE_CLERK_PUBLISHABLE_KEY)
        : undefined);
    this.auth = new NativeClerkProvider({
      store: secrets,
      config: {
        ...(configuredClerkUrl ? { clerkUrl: configuredClerkUrl } : {}),
        ...(process.env.T3CODE_CLERK_JWT_TEMPLATE
          ? { jwtTemplate: process.env.T3CODE_CLERK_JWT_TEMPLATE }
          : {}),
      },
      onStatus: (status) => this.emit("auth.changed", status),
    });
    const keys = new DpopKeyManager(secrets);
    const relay = new T3RelayClient(
      this.auth,
      keys,
      process.env.T3CODE_RELAY_URL || "https://relay.t3.codes",
    );
    let coordinator!: ConnectionCoordinator;
    const session = this.createSession(
      (inbox) => {
        if (this.allComputers.active) this.allComputers.updatePrimary(inbox);
        else this.emit("inbox.changed", inbox);
      },
      (error) => coordinator.handleClosed(error),
    );
    coordinator = new ConnectionCoordinator(this.auth, relay, session, {
      onConnection: (status) => this.emit("connection.changed", status),
      onEnvironment: (payload) => this.emit("environment.changed", payload),
      onError: (error) => this.emitError(error),
    });
    this.connection = coordinator;
    this.allComputers = new AllComputersInbox(relay, {
      createSession: (_environmentId, onInbox, onClosed) => this.createSession(onInbox, onClosed),
      onInbox: (inbox) => this.emit("inbox.changed", inbox),
      onError: (error) => this.emitError(error),
    });
    this.commands = new T3Commands((environmentId) => this.sessionFor(environmentId));
  }

  private createSession(
    onInbox: (inbox: InboxDto) => void,
    onClosed: (error: unknown) => void,
  ): T3EnvironmentSession {
    return new T3EnvironmentSession({
      onInbox,
      onThread: (thread) => this.emit("thread.snapshot", thread),
      onMessageDelta: (payload) => this.emit("message.delta", payload),
      onMessageCompleted: (payload) => this.emit("message.completed", payload),
      onApproval: (payload) => this.emit("approval.requested", payload),
      onInput: (payload) => this.emit("input.requested", payload),
      onClosed,
      onError: (error) => this.emitError(error),
    });
  }

  private primaryInbox(): InboxDto | null {
    const environmentId = this.connection.selectedId();
    if (environmentId === null) return null;
    try {
      return this.connection.session.projection.inbox(environmentId);
    } catch {
      return null;
    }
  }

  private sessionFor(environmentId?: string): T3EnvironmentSession {
    const primaryEnvironmentId = this.connection.selectedId();
    if (!environmentId || environmentId === primaryEnvironmentId) return this.connection.session;
    if (this.allComputers.active) return this.allComputers.sessionFor(environmentId, this.connection.session);
    throw new BridgeError("ENVIRONMENT_NOT_SELECTED", "Select that computer before changing its thread.");
  }

  private emit(name: string, payload: unknown): void {
    this.channel.write(event(name, payload));
  }

  private emitError(error: unknown): void {
    const bridgeError = asBridgeError(error);
    this.emit("error", { code: bridgeError.code, message: bridgeError.message, retryable: bridgeError.retryable });
  }

  private emitUnexpectedConnectionError(error: unknown): void {
    const bridgeError = asBridgeError(error);
    // The coordinator already publishes this expected terminal state through
    // connection.changed. Emitting a second generic error only duplicates it.
    if (bridgeError.code !== "UPSTREAM_OAUTH_DPOP_UNSUPPORTED") this.emitError(bridgeError);
  }

  async start(): Promise<void> {
    this.channel.start();
    const auth = await this.auth.initialize();
    this.emit("bridge.ready", {
      protocolVersion: PROTOCOL_VERSION,
      bridgeVersion: packageMetadata.version,
      upstream: UPSTREAM,
      allComputersEnvironmentId: ALL_COMPUTERS_ENVIRONMENT_ID,
    });
    this.emit("connection.changed", this.connection.status());
    if (auth.phase === "signedIn") {
      void this.connection.discoverAndConnectPreferred().catch((error) => this.emitUnexpectedConnectionError(error));
    }
  }

  private beginLogin(): void {
    if (this.login !== null) return;
    this.login = (async () => {
      try {
        const status = await this.auth.login();
        this.emit("auth.completed", status);
        await this.connection.discoverAndConnectPreferred();
      } catch (error) {
        this.emitUnexpectedConnectionError(error);
      } finally {
        this.login = null;
      }
    })();
  }

  async handle(request: BridgeRequest): Promise<void> {
    try {
      let payload: unknown;
      switch (request.type) {
        case "bridge.ping":
          payload = {
            ready: true,
            protocolVersion: PROTOCOL_VERSION,
            upstream: UPSTREAM,
            allComputersEnvironmentId: ALL_COMPUTERS_ENVIRONMENT_ID,
          };
          break;
        case "bridge.shutdown":
          payload = { shuttingDown: true };
          this.channel.write(success(request.requestId, payload));
          await this.shutdown();
          return;
        case "auth.status":
          payload = this.auth.status();
          break;
        case "auth.login":
          this.beginLogin();
          payload = { started: true };
          break;
        case "auth.logout":
          await this.allComputers.deactivate().catch(() => undefined);
          await this.connection.disconnect();
          payload = await this.auth.logout();
          break;
        case "environment.list":
          payload = { environments: await this.connection.discover(), selected: this.connection.selectedId() };
          break;
        case "environment.select":
          if (String(request.payload.environmentId) === ALL_COMPUTERS_ENVIRONMENT_ID) {
            payload = {
              selected: ALL_COMPUTERS_ENVIRONMENT_ID,
              inbox: await this.allComputers.activate(
                this.connection.list(),
                this.connection.selectedId(),
                this.primaryInbox(),
              ),
            };
          } else {
            await this.allComputers.deactivate();
            await this.connection.select(String(request.payload.environmentId));
            const inbox = this.primaryInbox();
            if (inbox !== null) this.emit("inbox.changed", inbox);
            payload = { selected: this.connection.selectedId(), ...(inbox === null ? {} : { inbox }) };
          }
          break;
        case "inbox.get":
          if (this.allComputers.active) {
            payload = this.allComputers.current();
            break;
          }
          if (this.connection.selectedId() === null) throw new BridgeError("ENVIRONMENT_REQUIRED", "Choose a T3 environment first.");
          payload = this.connection.session.projection.inbox(this.connection.selectedId()!);
          break;
        case "thread.open":
          {
            const session = this.sessionFor(
              typeof request.payload.environmentId === "string" ? request.payload.environmentId : undefined,
            );
            if (this.openThreadSession !== null && this.openThreadSession !== session) {
              await this.openThreadSession.closeThread();
            }
            this.openThreadSession = null;
            await session.openThread(String(request.payload.threadId));
            this.openThreadSession = session;
            payload = {
              opening: request.payload.threadId,
              models: session.projection.models(),
            };
          }
          break;
        case "thread.close":
          if (this.openThreadSession !== null) await this.openThreadSession.closeThread();
          this.openThreadSession = null;
          payload = {};
          break;
        default:
          payload = await this.commands.handle(request);
      }
      this.channel.write(success(request.requestId, payload));
    } catch (error) {
      const bridgeError = asBridgeError(error);
      this.channel.write(
        failure(request.requestId, bridgeError.code, bridgeError.message, bridgeError.retryable),
      );
    }
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.commands.clearAttachments();
    await this.allComputers.deactivate().catch(() => undefined);
    await this.connection.disconnect().catch(() => undefined);
    this.channel.stop();
  }
}
