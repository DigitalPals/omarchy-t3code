import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { BridgeError } from "../security/redact.ts";
import type { SecretStore } from "../security/secretStore.ts";

export const NATIVE_CALLBACK_SECRET_KEY = "t3-connect-native-callback";

const CALLBACK_TIMEOUT_MS = 10 * 60_000;
const CALLBACK_BODY_LIMIT = 4_096;

interface PendingCallback {
  version: 1;
  port: number;
  secret: string;
  expiresAtEpochMs: number;
}

export interface NativeCallbackResult {
  rotatingTokenNonce: string;
}

export interface NativeCallbackServer {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly result: Promise<NativeCallbackResult>;
  close(): Promise<void>;
}

export interface NativeCallbackServerOptions {
  store: SecretStore;
  startSignIn(provider: "google" | "github"): Promise<string>;
  timeoutMs?: number;
}

function safeEqual(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parsePendingCallback(value: string): PendingCallback {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object") {
    throw new BridgeError("AUTH_CALLBACK_INVALID", "The T3 Connect callback state is invalid.");
  }
  const pending = parsed as Record<string, unknown>;
  if (
    pending.version !== 1 ||
    !Number.isInteger(pending.port) ||
    Number(pending.port) < 1 ||
    Number(pending.port) > 65_535 ||
    typeof pending.secret !== "string" ||
    Buffer.from(pending.secret, "base64url").length !== 32 ||
    typeof pending.expiresAtEpochMs !== "number"
  ) {
    throw new BridgeError("AUTH_CALLBACK_INVALID", "The T3 Connect callback state is invalid.");
  }
  return pending as unknown as PendingCallback;
}

function parseNativeCallback(rawUrl: string): NativeCallbackResult {
  let callback: URL;
  try {
    callback = new URL(rawUrl);
  } catch {
    throw new BridgeError("AUTH_CALLBACK_INVALID", "T3 Connect returned an invalid browser callback.");
  }
  if (callback.protocol !== "t3code:" || callback.hostname !== "app") {
    throw new BridgeError("AUTH_CALLBACK_INVALID", "This is not a T3 Connect desktop callback.");
  }
  if (callback.searchParams.get("__clerk_status") === "failed") {
    throw new BridgeError("AUTH_CANCELLED", "T3 Connect browser sign-in was cancelled.");
  }
  const rotatingTokenNonce = callback.searchParams.get("rotating_token_nonce") ?? "";
  if (rotatingTokenNonce.length === 0 || rotatingTokenNonce.length > 4_096) {
    throw new BridgeError("AUTH_CALLBACK_INVALID", "T3 Connect returned an incomplete browser callback.");
  }
  return { rotatingTokenNonce };
}

function readSmallBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > CALLBACK_BODY_LIMIT) {
        reject(new BridgeError("AUTH_CALLBACK_INVALID", "The T3 Connect callback was too large."));
        request.destroy();
      }
    });
    request.once("end", () => resolve(body));
    request.once("error", reject);
  });
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  onFinished?: () => void,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value), onFinished);
}

function sendHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function loginPage(message = "Select the identity provider used by your T3 Connect account."): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Sign in · T3 Connect</title><style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(145deg,#101018,#1c1b2b);color:#f1f0fa}.panel{width:min(28rem,calc(100vw - 2rem));padding:2rem;border:1px solid #55516b;background:#191824;border-radius:.75rem}h1{font-size:1.5rem;margin:0 0 .75rem}p{color:#bbb7cd;line-height:1.55;margin:0 0 1.5rem}.providers{display:flex;flex-direction:column;gap:.75rem}.providers a{border:1px solid #6b6686;border-radius:.5rem;padding:.8rem 1rem;color:#f1f0fa;text-decoration:none;text-align:center;background:#29273a}.providers a:focus,.providers a:hover{background:#37334c}.return{font-size:.8rem;margin:1.4rem 0 0;color:#8f8aa3}
</style></head><body><main class="panel"><h1>Connect Omarchy to T3</h1><p>${message}</p><nav class="providers"><a href="/start?provider=google">Use a Google account</a><a href="/start?provider=github">Use a GitHub account</a></nav><p class="return">After authorization, the mini client will bring its Inbox back into view.</p></main></body></html>`;
}

export async function startNativeCallbackServer(
  options: NativeCallbackServerOptions,
): Promise<NativeCallbackServer> {
  const secret = randomBytes(32).toString("base64url");
  let settled = false;
  let signInStarted = false;
  let resolveResult!: (value: NativeCallbackResult) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<NativeCallbackResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const settle = (value: NativeCallbackResult | Error): void => {
    if (settled) return;
    settled = true;
    if (value instanceof Error) rejectResult(value);
    else resolveResult(value);
  };

  const server = createServer((request, response) => {
    void (async () => {
      const localUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && localUrl.pathname === "/") {
        sendHtml(response, 200, loginPage());
        return;
      }
      if (request.method === "GET" && localUrl.pathname === "/start") {
        const provider = localUrl.searchParams.get("provider");
        if (provider !== "google" && provider !== "github") {
          response.writeHead(400).end();
          return;
        }
        if (signInStarted) {
          response.writeHead(409).end();
          return;
        }
        signInStarted = true;
        try {
          const verificationUrl = new URL(await options.startSignIn(provider));
          if (verificationUrl.protocol !== "https:" || verificationUrl.username || verificationUrl.password) {
            throw new BridgeError("AUTH_START_FAILED", "T3 Connect returned an unsafe browser destination.");
          }
          response.writeHead(302, { location: verificationUrl.toString(), "cache-control": "no-store" });
          response.end();
        } catch {
          signInStarted = false;
          sendHtml(response, 502, loginPage("Authorization could not begin. Close this page and retry from the Omarchy panel."));
        }
        return;
      }
      if (request.method === "POST" && localUrl.pathname === "/oauth-callback") {
        const provided = String(request.headers.authorization ?? "").replace(/^Bearer\s+/iu, "");
        if (!safeEqual(provided, secret)) {
          response.writeHead(403).end();
          return;
        }
        try {
          const callback = parseNativeCallback(await readSmallBody(request));
          sendJson(response, 200, { handled: true, completed: true }, () => settle(callback));
        } catch (error) {
          const callbackError = error instanceof Error
            ? error
            : new BridgeError("AUTH_CALLBACK_INVALID", "T3 Connect browser sign-in failed.");
          sendJson(response, 200, { handled: true, completed: false }, () => settle(callbackError));
        }
        return;
      }
      response.writeHead(404).end();
    })().catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
      settle(error instanceof Error ? error : new BridgeError("AUTH_CALLBACK_FAILED", "T3 Connect callback handling failed."));
    });
  });
  server.on("clientError", (_error, socket) => socket.destroy());

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new BridgeError("CALLBACK_BIND_FAILED", "Could not start the T3 Connect loopback callback.");
  }
  const timeoutMs = options.timeoutMs ?? CALLBACK_TIMEOUT_MS;
  const timeout = setTimeout(() => {
    settle(new BridgeError("AUTH_TIMEOUT", "T3 Connect sign-in timed out. Try again from the panel."));
  }, timeoutMs);
  timeout.unref();

  try {
    await options.store.set(NATIVE_CALLBACK_SECRET_KEY, JSON.stringify({
      version: 1,
      port: address.port,
      secret,
      expiresAtEpochMs: Date.now() + timeoutMs,
    } satisfies PendingCallback));
  } catch (error) {
    clearTimeout(timeout);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }

  let closed = false;
  return {
    host: "127.0.0.1",
    port: address.port,
    result,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      clearTimeout(timeout);
      await options.store.remove(NATIVE_CALLBACK_SECRET_KEY).catch(() => undefined);
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

export async function forwardNativeCallback(
  rawUrl: string,
  store: SecretStore,
  request: typeof globalThis.fetch = globalThis.fetch,
): Promise<void> {
  parseNativeCallback(rawUrl);
  const stored = await store.get(NATIVE_CALLBACK_SECRET_KEY);
  if (stored === null) {
    throw new BridgeError("AUTH_CALLBACK_NOT_PENDING", "No Omarchy T3 Connect sign-in is waiting.");
  }
  const pending = parsePendingCallback(stored);
  if (pending.expiresAtEpochMs < Date.now()) {
    await store.remove(NATIVE_CALLBACK_SECRET_KEY).catch(() => undefined);
    throw new BridgeError("AUTH_CALLBACK_EXPIRED", "The Omarchy T3 Connect sign-in has expired.");
  }
  let response: Response;
  try {
    response = await request(`http://127.0.0.1:${pending.port}/oauth-callback`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${pending.secret}`,
        "content-type": "text/plain; charset=utf-8",
      },
      body: rawUrl,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new BridgeError("AUTH_CALLBACK_UNREACHABLE", "The Omarchy T3 Connect callback listener could not be reached.");
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || body === null || typeof body !== "object" || (body as { handled?: unknown }).handled !== true) {
    throw new BridgeError("AUTH_CALLBACK_REJECTED", "The Omarchy T3 Connect callback was not accepted.");
  }
}
