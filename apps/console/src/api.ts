import type { ApiError } from "@novi/shared";

// Calls the API through Vite's proxy (vite.config.ts). The officer's token
// lives in sessionStorage: it disappears when the tab is closed, which suits
// a shared computer at an agency.
const KEY = "novi-console-token";

export const session = {
  get: () => sessionStorage.getItem(KEY),
  set: (token: string) => sessionStorage.setItem(KEY, token),
  clear: () => sessionStorage.removeItem(KEY),
};

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export async function api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const token = session.get();
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = (data as ApiError | null)?.error?.code ?? "INTERNAL";
    throw new ApiFailure(res.status, code);
  }
  return data as T;
}
