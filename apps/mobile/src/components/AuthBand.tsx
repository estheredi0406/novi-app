import { router } from "expo-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { APP_LANGUAGES, currentLanguage, setAppLanguage } from "../i18n";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { NoviMark } from "./art/NoviMark";
import { ListenButton } from "./ListenButton";

const SIGN_UP_STEPS = 6;

// The top of every sign-up, login and PIN screen (approved design, 27 Oct;
// colours and back button in the "Lagune" style, D92):
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
          <View style={styles.spacer} />
        )}
        <View style={styles.right}>
          {/* D133: the language can be changed on every sign-up and login
              screen, not only on the first one; the choice holds everywhere. */}
          <View style={styles.langs} accessibilityRole="radiogroup">
            {APP_LANGUAGES.map(({ language }) => {
              const on = currentLanguage() === language;
              return (
                <Pressable
                  key={language}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={language}
                  onPress={() => setAppLanguage(language)}
                  hitSlop={6}
                  style={[styles.lang, on && styles.langOn]}
                >
                  <Text style={[styles.langText, on && styles.langTextOn]}>{language}</Text>
                </Pressable>
              );
            })}
          </View>
          <ListenButton text={listenText} />
        </View>
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
  right: { flexDirection: "row", alignItems: "center", gap: 8 },
  langs: { flexDirection: "row", borderRadius: 18, backgroundColor: colors.mist, padding: 3 },
  lang: { minWidth: 36, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  langOn: { backgroundColor: colors.action },
  langText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.action },
  langTextOn: { color: colors.white },
  back: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.mist },
  spacer: { width: 44, height: 44 },
  backText: { textAlign: "center", fontSize: 30, lineHeight: 34, marginTop: -3, color: colors.lagoon },
  progress: { gap: 10 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.lagoon },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.lagoon },
  text: { gap: 8 },
  title: { fontFamily: fonts.display, fontSize: 32, lineHeight: 42, color: colors.indigo },
  lede: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.muted },
});
