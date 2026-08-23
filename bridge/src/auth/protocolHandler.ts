import { spawn } from "node:child_process";

import { BridgeError, redactText } from "../security/redact.ts";

export const CALLBACK_DESKTOP_ID = "io.github.digitalpals.omarchy-t3code-callback.desktop";
export const LEGACY_CALLBACK_DESKTOP_ID = "io.github.omarchy-t3code-callback.desktop";
const T3_SCHEME_MIME = "x-scheme-handler/t3code";

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type MimeCommand = (args: string[]) => Promise<CommandResult>;

function runXdgMime(args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("xdg-mime", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new BridgeError("AUTH_CALLBACK_REGISTRATION_FAILED", "Desktop callback registration timed out."));
    }, 8_000);
    timeout.unref();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 8_192) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 8_192) stderr += chunk;
    });
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new BridgeError(
        "AUTH_CALLBACK_REGISTRATION_FAILED",
        "xdg-mime is required for the T3 Connect browser callback.",
      ));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

async function queryDefault(command: MimeCommand): Promise<string> {
  const result = await command(["query", "default", T3_SCHEME_MIME]);
  if (result.code !== 0) {
    throw new BridgeError(
      "AUTH_CALLBACK_REGISTRATION_FAILED",
      `Could not inspect the desktop callback handler: ${redactText(result.stderr)}`,
    );
  }
  return result.stdout.trim();
}

async function setDefault(command: MimeCommand, desktopId: string): Promise<void> {
  const result = await command(["default", desktopId, T3_SCHEME_MIME]);
  if (result.code !== 0) {
    throw new BridgeError(
      "AUTH_CALLBACK_REGISTRATION_FAILED",
      `Could not register the T3 Connect desktop callback: ${redactText(result.stderr)}`,
    );
  }
}

export async function activateT3ProtocolHandler(
  command: MimeCommand = runXdgMime,
  desktopId = CALLBACK_DESKTOP_ID,
): Promise<() => Promise<void>> {
  const previous = await queryDefault(command);
  if (previous !== desktopId) await setDefault(command, desktopId);
  const active = await queryDefault(command);
  if (active !== desktopId) {
    throw new BridgeError(
      "AUTH_CALLBACK_REGISTRATION_FAILED",
      "The desktop did not activate the Omarchy T3 Connect callback handler.",
    );
  }

  let restored = false;
  return async (): Promise<void> => {
    if (restored) return;
    restored = true;
    // With no previous owner, keep the installed callback handler available
    // for subsequent sign-ins. If another T3 client owned the scheme, return
    // ownership after this callback window closes.
    if (previous.length === 0 || previous === desktopId || previous === LEGACY_CALLBACK_DESKTOP_ID) return;
    try {
      if (await queryDefault(command) === desktopId) await setDefault(command, previous);
    } catch {
      // Authentication is already complete; restoration is best-effort and a
      // later T3 desktop launch can reclaim its registered scheme normally.
    }
  };
}
