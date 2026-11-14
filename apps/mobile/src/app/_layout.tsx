import "../i18n";
// One file per weight: importing the package root pulls in all 36 weights
// (about 18 MB) although the app uses four.
import { NotoSans_400Regular } from "@expo-google-fonts/noto-sans/400Regular";
import { NotoSans_600SemiBold } from "@expo-google-fonts/noto-sans/600SemiBold";
import { NotoSans_700Bold } from "@expo-google-fonts/noto-sans/700Bold";
import { NotoSansDisplay_800ExtraBold } from "@expo-google-fonts/noto-sans-display/800ExtraBold";
import { setAudioModeAsync } from "expo-audio";
import { useFonts } from "expo-font";
import { Stack, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { SplashIntro } from "../components/SplashIntro";
import { WebFrame } from "../components/WebFrame";
import { stopSpeaking } from "../lib/speak";
import { SessionProvider, useSession } from "../session/SessionProvider";
import { colors } from "../theme/colors";

// Shows nothing until we know the session, so no screen flashes. The guards
// decide which screens exist: member screens only once unlocked, sign-up and
// login only before. A Listen reading stops when she changes screen or the
// app goes to the background (D99).
function SpeechGuard() {
  const pathname = usePathname();
  useEffect(() => stopSpeaking, [pathname]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") stopSpeaking();
    });
    return () => sub.remove();
  }, []);
  return null;
}

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
      <WebFrame>
        <AppStack />
        {introDone ? null : <SplashIntro onDone={endIntro} />}
      </WebFrame>
      <SpeechGuard />
    </SessionProvider>
  );
}