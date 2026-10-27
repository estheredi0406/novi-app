import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Svg, { G, Path } from "react-native-svg";
import { NoviMark } from "../../components/art/NoviMark";
import { ListenButton } from "../../components/ListenButton";
import { type AppLanguage, currentLanguage, setAppLanguage } from "../../i18n";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

// Ewe first: it is the language most likely to be missing elsewhere.
const LANGUAGES: { language: AppLanguage; nameKey: string }[] = [
  { language: "EE", nameKey: "language.ee" },
  { language: "FR", nameKey: "language.fr" },
  { language: "EN", nameKey: "language.en" },
];

// Welcome (approved design, 27 Oct): the orange of the splash continues,
// with Novi's mark and name. The language is chosen right here, in one tap
// at the top; below, the two ways in, as in most apps: create an account,
// or log in to one she already has.
export default function WelcomeScreen() {
  const { t } = useTranslation();
  const selected = currentLanguage();

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <SafeAreaView edges={["top"]} style={styles.top}>
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 390 520" preserveAspectRatio="xMidYMid slice">
          <G stroke="#F47B45" strokeWidth={1.6} fill="none">
            <Path d="M0 90 C60 70 110 120 170 90 S270 60 330 98 S380 110 400 90" />
            <Path d="M0 430 C50 410 110 460 170 430 S260 390 320 432 S380 450 400 430" />
            <Path d="M80 0 C95 120 60 260 90 400 S110 480 80 520" />
            <Path d="M300 0 C285 140 320 300 295 450 S280 500 305 520" />
          </G>
        </Svg>
        <View style={styles.languages} accessibilityRole="radiogroup" accessibilityLabel={t("language.title")}>
          {LANGUAGES.map(({ language, nameKey }) => {
            const isSelected = language === selected;
            return (
              <Pressable
                key={language}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                onPress={() => setAppLanguage(language)}
                style={[styles.pill, isSelected && styles.pillSelected]}
              >
                <Text style={[styles.pillText, isSelected && styles.pillTextSelected]}>{t(nameKey)}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.hero}>
          <NoviMark size={112} onOrange />
          <Text style={styles.word} accessibilityRole="header">
            Novi
          </Text>
          <Text style={styles.tagline}>{t("splash.tagline")}</Text>
        </View>
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={styles.bottom}>
        <View style={styles.introRow}>
          <Text style={styles.intro}>{t("welcome.intro")}</Text>
          <ListenButton text={`${t("splash.tagline")}. ${t("welcome.intro")}`} />
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/phone")}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        >
          <Text style={styles.primaryText}>{t("welcome.create")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/login")}
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
        >
          <Text style={styles.secondaryText}>{t("welcome.haveAccount")}</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.shell },
  top: {
    flex: 1,
    backgroundColor: colors.accent,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.indigo,
    paddingHorizontal: 24,
    paddingBottom: 32,
    overflow: "hidden",
  },
  languages: { flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingTop: 12 },
  pill: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.white,
    justifyContent: "center",
  },
  pillSelected: { backgroundColor: colors.white },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.white },
  pillTextSelected: { color: colors.indigo },
  hero: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  word: { fontFamily: fonts.display, fontSize: 56, lineHeight: 64, color: colors.white },
  tagline: { fontFamily: fonts.bodySemiBold, fontSize: 18, lineHeight: 26, color: colors.white, textAlign: "center" },
  bottom: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 20, gap: 12 },
  introRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 4 },
  intro: { flex: 1, fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.muted },
  primary: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { backgroundColor: colors.indigo },
  primaryText: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.white },
  secondary: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryPressed: { backgroundColor: colors.mist },
  secondaryText: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.indigo },
});
