import { Redirect } from "expo-router";
import { useSession } from "../session/SessionProvider";

// Where the app starts: home when she is logged in, otherwise sign-up.
// S1.6e sends a locked phone to the PIN screen instead.
export default function Start() {
  const { status } = useSession();
  return <Redirect href={status === "open" ? "/home" : "/language"} />;
}