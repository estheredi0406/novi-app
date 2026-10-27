import "../i18n";
import { NotoSans_400Regular, NotoSans_600SemiBold, NotoSans_700Bold, useFonts } from "@expo-google-fonts/noto-sans";
import { NotoSansDisplay_800ExtraBold } from "@expo-google-fonts/noto-sans-display";
import { setAudioModeAsync } from "expo-audio";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { SplashIntro } from "../components/SplashIntro";
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

// The phone's own splash (navy, Novi's cowries and name; app.json) stays up
// until the fonts are loaded, then the same picture comes to life for a
// moment (SplashIntro) and fades into the app.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

// Wraps every screen. Loads Novi's fonts before showing anything, so text never
// appears first in a fallback font that lacks the Ewe letters.
export default function RootLayout() {
  const [introDone, setIntroDone] = useState(false);
  const endIntro = useCallback(() => setIntroDone(true), []);
  const [fontsLoaded] = useFonts({
    NotoSans_400Regular,
    NotoSans_600SemiBold,
    NotoSans_700Bold,
    NotoSansDisplay_800ExtraBold,
  });
  // Lets the Listen button speak even when the phone is on silent: a trader
  // at the market often keeps her ringer off, and Listen is how some members
  // read Novi. It plays only when she taps it.
  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true });
  }, []);

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <SessionProvider>
      <StatusBar style={introDone ? "dark" : "light"} />
      <AppStack />
      {introDone ? null : <SplashIntro onDone={endIntro} />}
    </SessionProvider>
  );
}