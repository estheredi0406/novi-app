import { Redirect } from "expo-router";
import { useSession } from "../session/SessionProvider";

// Where the app starts:
// - open: she unlocked Novi during this launch, so home
// - locked: she has an account on this phone, so her PIN
// - new: nobody has signed up on this phone, so sign-up
export default function Start() {
  const { status } = useSession();
  if (status === "open") return <Redirect href="/home" />;
  if (status === "locked") return <Redirect href="/login" />;
  return <Redirect href="/language" />;
}