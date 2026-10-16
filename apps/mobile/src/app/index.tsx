import { Redirect } from "expo-router";

// Where the app starts. Sign-up for now; part 2 sends an open session home,
// and S1.6e sends a locked phone to the PIN screen.
export default function Start() {
  return <Redirect href="/language" />;
}