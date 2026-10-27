import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { AuthBand } from "../../components/AuthBand";
import { type AppLanguage, currentLanguage, setAppLanguage } from "../../i18n";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// Ewe first: it is the language most likely to be missing elsewhere.
const LANGUAGES: { language: AppLanguage; nameKey: string }[] = [
  { language: "EE", nameKey: "language.ee" },
  { language: "FR", nameKey: "language.fr" },
  { language: "EN", nameKey: "language.en" },
];

// Screen A1: she chooses the language Novi speaks to her in. A member on a
// new or reset phone logs in from here instead of signing up again.
export default function LanguageScreen() {
  const { t } = useTranslation();
  const selected = currentLanguage();

  return (
    <Screen
      top={
        <AuthBand
          mark
          eyebrow={t("language.title")}
          title={t("welcome.greeting")}
          lede={t("language.lede")}
          listenText={`${t("language.title")}. ${t("language.lede")}`}
        />
      }
    >
      <View style={styles.options} accessibilityRole="radiogroup">
        {LANGUAGES.map(({ language, nameKey }) => {
          const isSelected = language === selected;
          return (
            <Pressable
              key={language}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              onPress={() => setAppLanguage(language)}
              style={[styles.option, isSelected && styles.optionSelected]}
            >
              <View style={[styles.radio, isSelected && styles.radioSelected]} />
              <Text style={styles.optionText}>{t(nameKey)}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.footer}>
        <PrimaryButton label={t("common.continue")} onPress={() => router.push("/phone")} />
        <Text style={[type.small, styles.muted, styles.center]}>{t("language.later")}</Text>
        <Pressable accessibilityRole="link" onPress={() => router.push("/login")} style={styles.linkButton}>
          <Text style={styles.link}>{t("language.haveAccount")}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 10 },
  indigo: { color: colors.indigo },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  center: { textAlign: "center" },
  options: { gap: 12 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 64,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
  },
  optionSelected: { backgroundColor: colors.mist, borderWidth: 2.5, borderColor: colors.accent },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.indigo },
  radioSelected: { borderWidth: 7, borderColor: colors.accent },
  optionText: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.ink },
  footer: { marginTop: "auto", gap: 12 },
  linkButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  link: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.action },
});