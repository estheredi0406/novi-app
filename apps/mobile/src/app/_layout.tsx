import "../i18n";
import { NotoSans_400Regular, NotoSans_600SemiBold, NotoSans_700Bold, useFonts } from "@expo-google-fonts/noto-sans";
import { NotoSansDisplay_800ExtraBold } from "@expo-google-fonts/noto-sans-display";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider, useSession } from "../session/SessionProvider";
import { colors } from "../theme/colors";

// Shows nothing until the session is known, so no screen flashes before
// the app knows whether to start sign-up or ask for the PIN.
// The guards decide which screens exist right now: the member screens (home,
// groups, invitations) only once she has unlocked Novi; sign-up and login
// only while she has not. When the status
// changes (she logs in, or logs out), Expo Router leaves any screen that
// is no longer allowed, so the back button cannot reopen it.
function AppStack() {
  const { status } = useSession();
  if (status === "loading") return null;

  const isOpen = status === "open";
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.shell } }}>
      <Stack.Protected guard={isOpen}>
        <Stack.Screen name="(member)" />
      </Stack.Protected>
      <Stack.Protected guard={!isOpen}>
        <Stack.Screen name="(signup)" />
        <Stack.Screen name="login" />
        <Stack.Screen name="forgot-pin" />
      </Stack.Protected>
    </Stack>
  );
}

// Wraps every screen. Loads Novi's fonts before showing anything, so text never
// appears first in a fallback font that lacks the Ewe letters.
export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    NotoSans_400Regular,
    NotoSans_600SemiBold,
    NotoSans_700Bold,
    NotoSansDisplay_800ExtraBold,
  });
  if (!fontsLoaded) return null;

  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <AppStack />
    </SessionProvider>
  );
}