import { Stack } from "expo-router";
import { SignUpProvider } from "../../signup/SignUpContext";
import { colors } from "../../theme/colors";

// Every sign-up screen shares one draft: what she has entered and proved so far.
export default function SignUpLayout() {
  return (
    <SignUpProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.shell } }} />
    </SignUpProvider>
  );
}