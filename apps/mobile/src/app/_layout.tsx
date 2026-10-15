import "../i18n";
import { NotoSans_400Regular, NotoSans_600SemiBold, NotoSans_700Bold, useFonts } from "@expo-google-fonts/noto-sans";
import { NotoSansDisplay_800ExtraBold } from "@expo-google-fonts/noto-sans-display";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SessionProvider, useSession } from "../session/SessionProvider";
import { colors } from "../theme/colors";

// Shows nothing until the session is known, so no screen flashes before
// the app knows whether to start sign-up or ask for the PIN.
function AppStack() {
  const { status } = useSession();
  if (status === "loading") return null;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.shell } }} />;
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