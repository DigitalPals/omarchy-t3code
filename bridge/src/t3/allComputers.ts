import type { PreparedConnection } from "@t3tools/client-runtime/connection";

import {
  ALL_COMPUTERS_ENVIRONMENT_ID,
  type CapabilitiesDto,
  type EnvironmentDto,
  type InboxDto,
  type ThreadSummaryDto,
} from "../protocol/types.ts";
import { BridgeError, redactText } from "../security/redact.ts";
import type { T3EnvironmentSession } from "./session.ts";

interface ConnectionSource {
  prepareConnection(environmentId: string): Promise<PreparedConnection>;
}

interface AllComputersCallbacks {
  createSession(
    environmentId: string,
    onInbox: (inbox: InboxDto) => void,
    onClosed: (error: unknown) => void,
  ): T3EnvironmentSession;
  onInbox(inbox: InboxDto): void;
  onError(error: BridgeError): void;
}

const EMPTY_CAPABILITIES: CapabilitiesDto = {
  settlement: false,
  snooze: false,
  pinning: false,
  pinReorder: false,
  titleRegeneration: false,
  threadPagination: false,
};

function newestFirst(left: ThreadSummaryDto, right: ThreadSummaryDto): number {
  return Date.parse(right.latestActivityAt) - Date.parse(left.latestActivityAt)
    || left.environmentId.localeCompare(right.environmentId)
    || left.id.localeCompare(right.id);
}

function snoozedFirst(left: ThreadSummaryDto, right: ThreadSummaryDto): number {
  return Date.parse(left.snoozedUntil ?? "") - Date.parse(right.snoozedUntil ?? "")
    || newestFirst(left, right);
}

function sharedCapabilities(inboxes: readonly InboxDto[]): CapabilitiesDto {
  if (inboxes.length === 0) return EMPTY_CAPABILITIES;
  return {
    settlement: inboxes.every((inbox) => inbox.capabilities.settlement),
    snooze: inboxes.every((inbox) => inbox.capabilities.snooze),
    pinning: inboxes.every((inbox) => inbox.capabilities.pinning),
    pinReorder: inboxes.every((inbox) => inbox.capabilities.pinReorder),
    titleRegeneration: inboxes.every((inbox) => inbox.capabilities.titleRegeneration),
    threadPagination: inboxes.every((inbox) => inbox.capabilities.threadPagination),
  };
}

export function combineComputerInboxes(inboxes: readonly InboxDto[]): InboxDto {
  const updatedAt = inboxes
    .map((inbox) => inbox.updatedAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? "";
  return {
    environmentId: ALL_COMPUTERS_ENVIRONMENT_ID,
    updatedAt,
    capabilities: sharedCapabilities(inboxes),
    projects: [],
    models: [],
    pinned: inboxes.flatMap((inbox) => inbox.pinned).sort(newestFirst),
    active: inboxes.flatMap((inbox) => inbox.active).sort(newestFirst),
    snoozed: inboxes.flatMap((inbox) => inbox.snoozed).sort(snoozedFirst),
    settled: inboxes.flatMap((inbox) => inbox.settled).sort(newestFirst),
  };
}

export class AllComputersInbox {
  private activeValue = false;
  private generation = 0;
  private primaryEnvironmentId: string | null = null;
  private readonly inboxes = new Map<string, InboxDto>();
  private readonly sessions = new Map<string, T3EnvironmentSession>();

  constructor(
    private readonly connections: ConnectionSource,
    private readonly callbacks: AllComputersCallbacks,
  ) {}

  get active(): boolean {
    return this.activeValue;
  }

  current(): InboxDto {
    if (!this.activeValue) throw new BridgeError("ALL_COMPUTERS_INACTIVE", "Select All computers first.");
    return combineComputerInboxes([...this.inboxes.values()]);
  }

  updatePrimary(inbox: InboxDto): void {
    if (!this.activeValue || inbox.environmentId !== this.primaryEnvironmentId) return;
    this.inboxes.set(inbox.environmentId, inbox);
    this.callbacks.onInbox(this.current());
  }

  sessionFor(
    environmentId: string,
    primarySession: T3EnvironmentSession,
  ): T3EnvironmentSession {
    if (!this.activeValue) throw new BridgeError("ALL_COMPUTERS_INACTIVE", "Select All computers first.");
    if (environmentId === this.primaryEnvironmentId) return primarySession;
    const session = this.sessions.get(environmentId);
    if (!session) throw new BridgeError("ENVIRONMENT_NOT_CONNECTED", "That computer is not connected. Refresh All computers and try again.", true);
    return session;
  }

  async activate(
    environments: readonly EnvironmentDto[],
    primaryEnvironmentId: string | null,
    primaryInbox: InboxDto | null,
  ): Promise<InboxDto> {
    if (environments.length <= 2) {
      throw new BridgeError("ALL_COMPUTERS_UNAVAILABLE", "All computers requires more than two linked computers.");
    }
    await this.deactivate();
    const generation = ++this.generation;
    this.activeValue = true;
    this.primaryEnvironmentId = primaryEnvironmentId;
    if (primaryInbox !== null) this.inboxes.set(primaryInbox.environmentId, primaryInbox);
    this.callbacks.onInbox(this.current());

    await Promise.all(environments
      .filter((environment) => environment.id !== primaryEnvironmentId)
      .map(async (environment) => {
        let session: T3EnvironmentSession | null = null;
        try {
          session = this.callbacks.createSession(
            environment.id,
            (inbox) => {
              if (!this.activeValue || generation !== this.generation) return;
              this.inboxes.set(environment.id, inbox);
              this.callbacks.onInbox(this.current());
            },
            (error) => {
              if (!this.activeValue || generation !== this.generation) return;
              const disconnectedSession = this.sessions.get(environment.id);
              this.sessions.delete(environment.id);
              this.inboxes.delete(environment.id);
              this.callbacks.onInbox(this.current());
              if (disconnectedSession !== undefined) {
                void disconnectedSession.close().catch(() => undefined);
              }
              this.callbacks.onError(new BridgeError(
                "ENVIRONMENT_DISCONNECTED",
                `${environment.label} disconnected: ${redactText(error)}`,
                true,
              ));
            },
          );
          this.sessions.set(environment.id, session);
          const prepared = await this.connections.prepareConnection(environment.id);
          if (!this.activeValue || generation !== this.generation) return;
          await session.connect(prepared);
        } catch (error) {
          if (this.sessions.get(environment.id) === session) this.sessions.delete(environment.id);
          if (session !== null) await session.close().catch(() => undefined);
          if (!this.activeValue || generation !== this.generation) return;
          this.callbacks.onError(new BridgeError(
            "ENVIRONMENT_CONNECT_FAILED",
            `Could not connect ${environment.label}: ${redactText(error)}`,
            true,
          ));
        }
      }));
    return this.current();
  }

  async deactivate(): Promise<void> {
    ++this.generation;
    this.activeValue = false;
    this.primaryEnvironmentId = null;
    this.inboxes.clear();
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map((session) => session.close().catch(() => undefined)));
  }
}
