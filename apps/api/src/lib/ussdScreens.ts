// D164: a USSD call has no memory between two key presses, so each press
// rebuilds the menus from the database. Before acting (paying, accepting,
// declining), we check that what she is answering is still exactly what the
// screen showed her in this same call: the same group, the same version of the
// rules, the same amount. If anything changed in between, we act on nothing.
//
// Kept in memory: a call lasts a few minutes at most. If the server restarts
// during a call, the next press finds nothing and she is asked to start again,
// which is safe.

const KEEP_MS = 5 * 60 * 1000;
const MAX_CALLS = 5000;

type Shown = { what: string; at: number };
const shown = new Map<string, Shown>();

const keyOf = (sessionId: string, phone: string, screen: string) => `${sessionId}|${phone}|${screen}`;

// Remembers what one screen of this call showed.
export function remember(sessionId: string, phone: string, screen: string, what: string): void {
  const now = Date.now();
  if (shown.size >= MAX_CALLS) {
    for (const [k, v] of shown) if (now - v.at > KEEP_MS) shown.delete(k);
    // Still full: drop the oldest, so the memory never grows without limit.
    if (shown.size >= MAX_CALLS) shown.delete(shown.keys().next().value as string);
  }
  shown.set(keyOf(sessionId, phone, screen), { what, at: now });
}

// True only when this call showed exactly this, a few minutes ago at most.
export function sawExactly(sessionId: string, phone: string, screen: string, what: string): boolean {
  const seen = shown.get(keyOf(sessionId, phone, screen));
  return !!seen && seen.what === what && Date.now() - seen.at <= KEEP_MS;
}
