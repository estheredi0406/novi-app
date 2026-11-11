import { requestRecordingPermissionsAsync } from "expo-audio";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { WebView as WebViewType } from "react-native-webview";
import { canCallInApp } from "../../lib/openCall";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";
import { API_URL } from "../../lib/apiUrl";

// D85: the group call, inside Novi. The call page runs in a web view with
// her microphone; "Quitter l'appel" closes the page and the call with it.
// Only Novi's own call page (D112) may load here, or a Daily room if the
// server still uses Daily (D71); nothing else from the web.
const DAILY = /^https:\/\/[a-z0-9-]+\.daily\.co\//i;
const NOVI_CALL = `${API_URL.replace(/\/$/, "")}/call/`;
const allowed = (address: string) =>
  DAILY.test(address) || (NOVI_CALL !== "/call/" && address.startsWith(NOVI_CALL));

// Loaded only on a Novi built with the web view, so an older Novi never
// touches a native part it does not have.
const WebView: typeof WebViewType | null = canCallInApp()
  ? (require("react-native-webview") as { WebView: typeof WebViewType }).WebView
  : null;

export default function CallScreen() {
  const { t } = useTranslation();
  const { url, title } = useLocalSearchParams<{
    url: string;
    title?: string;
  }>();
  const [ready, setReady] = useState(false);
  const [micAsked, setMicAsked] = useState(false);

  // Android asks the phone for the microphone before the page can use it.
  useEffect(() => {
    requestRecordingPermissionsAsync()
      .catch(() => undefined)
      .finally(() => setMicAsked(true));
  }, []);

  const safe = typeof url === "string" && allowed(url) && WebView !== null;

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.bar}>
        <Text style={styles.title} numberOfLines={1}>
          {title || t("call.title")}
        </Text>
        {/* Novi's own page has its own "Quitter" (D112), once it has loaded. */}
        {!ready || (typeof url === "string" && DAILY.test(url)) ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.leave}
          >
            <Text style={styles.leaveText}>{t("call.leave")}</Text>
          </Pressable>
        ) : null}
      </View>
      {!safe ? (
        <Text style={styles.note}>{t("call.unavailable")}</Text>
      ) : micAsked && WebView ? (
        <View style={styles.room}>
          <WebView
            source={{ uri: url }}
            originWhitelist={["https://*", "http://*"]}
            onShouldStartLoadWithRequest={(req) =>
              allowed(req.url) || req.url.startsWith("about:")
            }
            // Novi's call page says "leave" when she taps its own button.
            onMessage={(event) => {
              if (event.nativeEvent.data === "leave") router.back();
            }}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            mediaCapturePermissionGrantType="grant"
            onLoadEnd={() => setReady(true)}
            style={styles.web}
          />
          {!ready ? (
            <ActivityIndicator
              style={styles.spinner}
              color={colors.white}
              size="large"
            />
          ) : null}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.indigo },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  title: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 18,
    color: colors.white,
  },
  leave: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  leaveText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.white },
  room: { flex: 1 },
  web: { flex: 1, backgroundColor: colors.indigo },
  spinner: { position: "absolute", top: "45%", alignSelf: "center" },
  note: {
    margin: 24,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.white,
  },
});
