import { Redirect } from "expo-router";
import { useSession } from "../session/SessionProvider";

// Where the app starts: home if unlocked, the PIN if she has an account here,
// sign-up otherwise.
export default function Start() {
  const { status } = useSession();
  if (status === "open") return <Redirect href="/home" />;
  if (status === "locked") return <Redirect href="/login" />;
  return <Redirect href="/language" />;
}