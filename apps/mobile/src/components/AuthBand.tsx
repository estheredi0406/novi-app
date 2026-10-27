import { router } from "expo-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { NoviMark } from "./art/NoviMark";
import { ListenButton } from "./ListenButton";

const SIGN_UP_STEPS = 6;

// The top of every sign-up, login and PIN screen (approved design, 27 Oct):
// on the plain cotton screen, back (or Novi's mark) and Listen, then for a
// sign-up step its name and a progress bar, then the title and one line,
// all aligned to the left like the rest of the app.
export function AuthBand({
  step,
  eyebrow,
  title,
  lede,
  listenText,
  mark = false,
  children,
}: {
  step?: number;
  eyebrow?: string;
  title: string;
  lede?: string;
  listenText: string;
  mark?: boolean; // Novi's mark in place of back, on the login screen
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {mark ? (
          <NoviMark size={56} />
        ) : router.canGoBack() ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
            onPress={() => router.back()}
            style={styles.back}
          >
            <Text style={styles.backText}>‹</Text>
          </Pressable>
        ) : (
          <View style={styles.back} />
        )}
        <ListenButton text={listenText} />
      </View>

      {step ? (
        <View style={styles.progress} accessible accessibilityLabel={`${step} / ${SIGN_UP_STEPS}`}>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${(step / SIGN_UP_STEPS) * 100}%` }]} />
          </View>
        </View>
      ) : eyebrow ? (
        <Text style={styles.eyebrow}>{eyebrow}</Text>
      ) : null}

      <View style={styles.text}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {lede ? <Text style={styles.lede}>{lede}</Text> : null}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 24, paddingTop: 12, gap: 20 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  back: { width: 44, height: 44, justifyContent: "center" },
  backText: { fontSize: 36, lineHeight: 40, color: colors.indigo },
  progress: { gap: 10 },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: "#C2410C", // a darker orange, readable on cotton
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  text: { gap: 8 },
  title: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, color: colors.indigo },
  lede: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.muted },
});
