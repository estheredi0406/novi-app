import type { ApiError as ApiErrorBody, AuthTokens } from "@novi/shared";
import { clearTokens, getTokens, saveTokens } from "../lib/storage";

const API_URL = process.env.EXPO_PUBLIC_API_URL;
// Long enough for a slow mobile connection, short enough not to leave her waiting.
const TIMEOUT_MS = 15_000;

type Method = "GET" | "POST" | "PATCH";

// An error the screens can show in her language: messageKey is a key in the
// translation files. challengeId comes with NEW_DEVICE.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly messageKey: string,
    readonly retryAfterSec?: number,
    readonly challengeId?: string,
  ) {
    super(code);
  }
}

const noConnection = () => new ApiError(0, "NETWORK", "errors.noConnection");

// Sends one request, giving up after TIMEOUT_MS.
async function send(path: string, method: Method, body?: unknown, accessToken?: string): Promise<Response> {
  if (!API_URL) throw noConnection();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw noConnection();
  } finally {
    clearTimeout(timer);
  }
}

// Turns a response into its data, or into an ApiError carrying the API's message key.
async function parse<T>(res: Response): Promise<T> {
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
  try {
    const { error } = (await res.json()) as ApiErrorBody;
    throw new ApiError(res.status, error.code, error.messageKey, error.retryAfterSec, error.challengeId);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(res.status, "INTERNAL", "errors.internal");
  }
}

// Renews the tokens. Only one renewal runs at a time: requests failing together
// wait for the same renewal, instead of each presenting the same refresh token,
// which the API would treat as reuse (D19).
let renewal: Promise<boolean> | null = null;
function renewTokens(): Promise<boolean> {
  renewal ??= (async () => {
    try {
      const tokens = await getTokens();
      if (!tokens) return false;
      const res = await send("/v1/auth/refresh", "POST", { refreshToken: tokens.refreshToken });
      if (!res.ok) {
        await clearTokens();
        return false;
      }
      await saveTokens((await res.json()) as AuthTokens);
      return true;
    } finally {
      renewal = null;
    }
  })();
  return renewal;
}

// Endpoints anyone may call: codes, identity check, sign-up, login.
export async function publicRequest<T>(method: Method, path: string, body?: unknown): Promise<T> {
  return parse<T>(await send(path, method, body));
}

// A logged-in member's endpoints. If the 15-minute access token has expired,
// renews it once and repeats the request.
export async function memberRequest<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const tokens = await getTokens();
  if (!tokens) throw new ApiError(401, "UNAUTHENTICATED", "errors.unauthenticated");

  let res = await send(path, method, body, tokens.accessToken);
  if (res.status === 401 && (await renewTokens())) {
    const renewed = await getTokens();
    res = await send(path, method, body, renewed?.accessToken);
  }
  return parse<T>(res);
}

// The translation key to show for any error a request may throw.
export function errorKey(err: unknown): string {
  return err instanceof ApiError ? err.messageKey : "errors.internal";
}