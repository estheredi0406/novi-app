import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "../components/PrimaryButton";
import { Screen } from "../components/Screen";
import { type AppLanguage, setAppLanguage } from "../i18n";
import { useSession } from "../session/SessionProvider";
import { colors } from "../theme/colors";
import { fonts, type } from "../theme/typography";

const LANGUAGES: AppLanguage[] = ["EE", "FR", "EN"];

// Temporary first screen proving the foundations: navigation, palette, fonts
// (including the Ewe letters), language switching and the session. Replaced in S1.6d.
export default function Welcome() {
  const { t, i18n } = useTranslation();
  const { status } = useSession();

  return (
    <Screen>
      <View style={styles.middle}>
        <Text style={[type.display, styles.title]}>Novi</Text>
        <Text style={[type.title, styles.ink]}>{t("welcome.greeting")}</Text>
        <Text style={[type.body, styles.ink]}>{t("phone.title")}</Text>
        <Text style={[type.body, styles.ink]}>ɖ ƒ ɣ ŋ ɔ ɛ ʋ Ɖ Ƒ Ɣ Ŋ Ɔ Ɛ Ʋ</Text>
        <Text style={[type.small, styles.muted]}>Session: {status}</Text>

        <View style={styles.row}>
          {LANGUAGES.map((language) => {
            const selected = i18n.language === language.toLowerCase();
            return (
              <Pressable
                key={language}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setAppLanguage(language)}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {t(`language.${language.toLowerCase()}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[type.small, styles.muted]}>{t("welcome.foundations")}</Text>
      </View>
      <PrimaryButton label={t("welcome.check")} onPress={() => router.push("/health")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  middle: { flex: 1, justifyContent: "center", gap: 12 },
  title: { color: colors.indigo },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.white,
    justifyContent: "center",
  },
  chipSelected: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  chipText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  chipTextSelected: { color: colors.onDark },
});