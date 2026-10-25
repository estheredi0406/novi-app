// The last one-time code the server returned in pilot mode (D61). The API
// client saves it from any response; the code screens show it.
let current: string | null = null;
const listeners = new Set<() => void>();

export const pilotCodeStore = {
  get: () => current,
  set(code: string | null) {
    current = code;
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
