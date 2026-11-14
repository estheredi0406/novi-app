import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { WebView as WebViewType } from "react-native-webview";
import { checkContribution } from "../../api/money";
import { API_URL } from "../../lib/apiUrl";
import { canCallInApp } from "../../lib/openCall";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

// D86: the payment page inside Novi. In the pilot it is FedaPay's test page;
// with live mobile money her phone shows the prompt instead. Only FedaPay's
// pages load here. It closes by itself once the payment is confirmed.
const FEDAPAY = /^https:\/\/([a-z0-9-]+\.)*fedapay\.com\//i;
const CHECK_MS = 3000;

const WebView: typeof WebViewType | null = canCallInApp()
  ? (require("react-native-webview") as { WebView: typeof WebViewType }).WebView
  : null;

export default function PayScreen() {
  const { t } = useTranslation();
  const { url, contributionId, amount } = useLocalSearchParams<{
    url: string;
    contributionId: string;
    amount?: string;
  }>();
  const [ready, setReady] = useState(false);

  // Back to the round as soon as the payment is no longer pending: the round
  // screen then shows the receipt (or what went wrong).
  useEffect(() => {
    if (!contributionId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const now = await checkContribution(contributionId);
        if (!stopped && now.status !== "PENDING") {
          stopped = true;
          router.back();
          return;
        }
      } catch {
        // a failed check simply tries again
      }
      if (!stopped) timer = setTimeout(() => void tick(), CHECK_MS);
    };
    let timer = setTimeout(() => void tick(), CHECK_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [contributionId]);

  const safe = typeof url === "string" && FEDAPAY.test(url) && WebView !== null;

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.close}
        >
          <Text style={styles.closeText}>{t("pay.close")}</Text>
        </Pressable>
        <View style={styles.titles}>
          <Text style={styles.title}>
            {amount ? t("pay.title", { amount }) : t("pay.titleShort")}
          </Text>
          <Text style={styles.sub}>{t("pay.secure")}</Text>
        </View>
      </View>
      {!safe || !WebView ? (
        <Text style={styles.note}>{t("pay.unavailable")}</Text>
      ) : (
        <View style={styles.page}>
          <WebView
            source={{ uri: url }}
            originWhitelist={["https://*"]}
            onShouldStartLoadWithRequest={(req) => {
              if (FEDAPAY.test(req.url) || req.url.startsWith("about:"))
                return true;
              // D133: the payment page sends her back to Novi once done:
              // close the page here; the round screen shows the receipt.
              if (API_URL && req.url.startsWith(API_URL)) {
                router.back();
                return false;
              }
              void Linking.openURL(req.url);
              return false;
            }}
            javaScriptEnabled
            domStorageEnabled
            onLoadEnd={() => setReady(true)}
            style={styles.web}
          />
          {!ready ? (
            <ActivityIndicator
              style={styles.spinner}
              color={colors.indigo}
              size="large"
            />
          ) : null}
        </View>
      )}
      <Text style={styles.foot}>{t("pay.waiting")}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.shell },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.line,
  },
  close: { minHeight: 44, justifyContent: "center", paddingRight: 8 },
  closeText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.indigo },
  titles: { flex: 1, alignItems: "flex-end" },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.indigo },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  page: { flex: 1 },
  web: { flex: 1, backgroundColor: colors.white },
  spinner: { position: "absolute", top: "40%", alignSelf: "center" },
  note: { margin: 24, fontFamily: fonts.body, fontSize: 16, color: colors.ink },
  foot: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    textAlign: "center",
  },
});
