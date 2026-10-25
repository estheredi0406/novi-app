import type { AuthResponse, MemberProfile } from "@novi/shared";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { logout as logoutRequest } from "../api/auth";
import { restoreSavedLanguage, setAppLanguage } from "../i18n";
import { clearTokens, getMember, saveMember, saveTokens } from "../lib/storage";

// Where the app stands:
// - loading: reading the phone's storage at launch
// - new: nobody has signed up on this phone; sign-up starts
// - locked: a member uses this phone; her PIN opens Novi
// - open: she unlocked Novi during this launch
type Status = "loading" | "new" | "locked" | "open";

type SessionState = {
  status: Status;
  phone: string | null;
  displayName: string | null;
  member: MemberProfile | null;
};

type Session = SessionState & {
  open: (auth: AuthResponse, phone: string) => Promise<void>;
  lock: () => Promise<void>;
  setMember: (member: MemberProfile) => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading", phone: null, displayName: null, member: null });

  // At launch: restore her language, discard old tokens (Novi asks for the PIN
  // each time it opens, D23), and decide between sign-up and unlock.
  useEffect(() => {
    void (async () => {
      await restoreSavedLanguage();
      await clearTokens();
      const saved = await getMember();
      setState(
        saved
          ? { status: "locked", phone: saved.phone, displayName: saved.displayName, member: null }
          : { status: "new", phone: null, displayName: null, member: null },
      );
    })();
  }, []);

  // After sign-up, login or trusting a phone: keeps the tokens and opens Novi.
  const open = useCallback(async (auth: AuthResponse, phone: string) => {
    await saveTokens(auth.tokens);
    await saveMember(phone, auth.member.displayName);
    setAppLanguage(auth.member.language);
    setState({ status: "open", phone, displayName: auth.member.displayName, member: auth.member });
  }, []);

  // Logs out of this phone. Her phone number stays, so next time only her PIN is asked.
  const lock = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Without a connection the server session ends on its own; the phone forgets it now.
    }
    await clearTokens();
    setState((current) => ({ ...current, status: "locked", member: null }));
  }, []);

  // After she changes her profile (for example the name her groups see).
  const setMember = useCallback(
    async (member: MemberProfile) => {
      setState((current) => ({ ...current, member, displayName: member.displayName }));
      if (state.phone) await saveMember(state.phone, member.displayName);
    },
    [state.phone],
  );

  return <SessionContext.Provider value={{ ...state, open, lock, setMember }}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside SessionProvider");
  return session;
}