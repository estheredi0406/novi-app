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

// D85: the group call, inside Novi. The Daily room runs in a web view with
// her microphone; "Quitter l'appel" closes the page and the call with it.
// Only Daily's own rooms may load here, nothing else from the web.
const DAILY = /^https:\/\/[a-z0-9-]+\.daily\.co\//i;

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

  const safe = typeof url === "string" && DAILY.test(url) && WebView !== null;

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.bar}>
        <Text style={styles.title} numberOfLines={1}>
          {title || t("call.title")}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.leave}
        >
          <Text style={styles.leaveText}>{t("call.leave")}</Text>
        </Pressable>
      </View>
      {!safe ? (
        <Text style={styles.note}>{t("call.unavailable")}</Text>
      ) : micAsked && WebView ? (
        <View style={styles.room}>
          <WebView
            source={{ uri: url }}
            originWhitelist={["https://*"]}
            onShouldStartLoadWithRequest={(req) =>
              DAILY.test(req.url) || req.url.startsWith("about:")
            }
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
