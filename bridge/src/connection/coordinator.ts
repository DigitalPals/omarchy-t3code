import type { AuthProvider } from "../auth/provider.ts";
import type { ConnectionStatusDto, EnvironmentDto } from "../protocol/types.ts";
import { BridgeError, redactText } from "../security/redact.ts";
import { readSelectedEnvironment, writeSelectedEnvironment } from "../state/preferences.ts";
import { T3RelayClient } from "../t3/relay.ts";
import { T3EnvironmentSession } from "../t3/session.ts";

export interface ConnectionCallbacks {
  onConnection(status: ConnectionStatusDto): void;
  onEnvironment(payload: { selected: string | null; environments: EnvironmentDto[] }): void;
  onError(error: BridgeError): void;
}

export class ConnectionCoordinator {
  private environments: EnvironmentDto[] = [];
  private selected: string | null = null;
  private generation = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private statusValue: ConnectionStatusDto = {
    phase: "disconnected",
    environmentId: null,
    detail: null,
    attempt: 0,
  };

  constructor(
    private readonly auth: AuthProvider,
    private readonly relay: T3RelayClient,
    readonly session: T3EnvironmentSession,
    private readonly callbacks: ConnectionCallbacks,
  ) {}

  status(): ConnectionStatusDto {
    return this.statusValue;
  }

  list(): EnvironmentDto[] {
    return this.environments;
  }

  selectedId(): string | null {
    return this.selected;
  }

  private publish(status: ConnectionStatusDto): void {
    this.statusValue = status;
    this.callbacks.onConnection(status);
  }

  private publishEnvironments(): void {
    this.callbacks.onEnvironment({ selected: this.selected, environments: this.environments });
  }

  async discover(): Promise<EnvironmentDto[]> {
    const wasConnected = this.statusValue.phase === "connected";
    this.publish({ phase: "discovering", environmentId: this.selected, detail: null, attempt: 0 });
    try {
      this.environments = await this.relay.listEnvironments();
      if (this.selected !== null && !this.environments.some((entry) => entry.id === this.selected)) {
        ++this.generation;
        await this.session.close();
        this.selected = null;
      }
      this.publishEnvironments();
      this.publish({
        phase: wasConnected && this.selected !== null ? "connected" : "disconnected",
        environmentId: this.selected,
        detail: null,
        attempt: 0,
      });
      return this.environments;
    } catch (error) {
      const bridgeError = error instanceof BridgeError ? error : new BridgeError("ENVIRONMENT_DISCOVERY_FAILED", redactText(error), true);
      this.publish({
        phase: wasConnected ? "connected" : "error",
        environmentId: this.selected,
        detail: bridgeError.message,
        attempt: 0,
      });
      throw bridgeError;
    }
  }

  async discoverAndConnectPreferred(): Promise<void> {
    const environments = await this.discover();
    const remembered = await readSelectedEnvironment();
    const target = environments.find((entry) => entry.id === remembered) ?? environments[0];
    if (target) await this.select(target.id);
  }

  async select(environmentId: string): Promise<void> {
    if (!this.environments.some((entry) => entry.id === environmentId)) {
      throw new BridgeError("ENVIRONMENT_NOT_FOUND", "Refresh environments and choose one of the linked T3 environments.");
    }
    if (this.selected === environmentId && this.statusValue.phase === "connected") return;
    this.selected = environmentId;
    await writeSelectedEnvironment(environmentId);
    this.publishEnvironments();
    const generation = ++this.generation;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    await this.connectAttempt(generation, 0);
  }

  private async connectAttempt(generation: number, attempt: number): Promise<void> {
    if (generation !== this.generation || this.selected === null) return;
    this.publish({
      phase: attempt === 0 ? "connecting" : "reconnecting",
      environmentId: this.selected,
      detail: null,
      attempt,
    });
    try {
      const prepared = await this.relay.prepareConnection(this.selected);
      if (generation !== this.generation) return;
      const config = await this.session.connect(prepared);
      const matched = this.environments.find((entry) => entry.id === this.selected);
      if (matched) matched.serverVersion = config.environment.serverVersion;
      this.publishEnvironments();
      this.publish({ phase: "connected", environmentId: this.selected, detail: null, attempt });
    } catch (error) {
      if (generation !== this.generation) return;
      const bridgeError = error instanceof BridgeError ? error : new BridgeError("ENVIRONMENT_CONNECT_FAILED", redactText(error), true);
      const blocked = bridgeError.code === "UPSTREAM_OAUTH_DPOP_UNSUPPORTED" || !bridgeError.retryable;
      this.publish({
        phase: blocked ? "blocked" : "error",
        environmentId: this.selected,
        detail: bridgeError.message,
        attempt,
      });
      if (blocked) throw bridgeError;
      this.scheduleReconnect(generation, attempt + 1);
      throw bridgeError;
    }
  }

  handleClosed(error: unknown): void {
    if (this.selected === null) return;
    const generation = this.generation;
    const nextAttempt = Math.max(1, this.statusValue.attempt + 1);
    this.publish({
      phase: "reconnecting",
      environmentId: this.selected,
      detail: redactText(error),
      attempt: nextAttempt,
    });
    this.scheduleReconnect(generation, nextAttempt);
  }

  private scheduleReconnect(generation: number, attempt: number): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt - 1, 5));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connectAttempt(generation, attempt).catch((error) => this.callbacks.onError(error));
    }, delay);
    this.retryTimer.unref();
  }

  async disconnect(): Promise<void> {
    ++this.generation;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    await this.session.close();
    this.publish({ phase: "disconnected", environmentId: this.selected, detail: null, attempt: 0 });
  }
}
