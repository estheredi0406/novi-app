import { useCallback, useEffect, useState } from "react";
import { ApiFailure } from "./api";

// Loads a page's data, and reloads it on demand. A 401 means the officer's
// session ended (logout elsewhere, or the 8 hours passed): back to login.
export function useLoad<T>(load: () => Promise<T>, onExpired: () => void) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(() => {
    load().then(
      (value) => {
        setData(value);
        setFailed(false);
      },
      (err: unknown) => {
        if (err instanceof ApiFailure && err.status === 401) onExpired();
        else setFailed(true);
      },
    );
    // Loaded once per page: App gives each page a key from its id, so
    // opening another group mounts a fresh page rather than reusing this one.
  }, []);

  useEffect(reload, [reload]);
  return { data, failed, reload };
}
