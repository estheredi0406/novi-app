import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { BackHeader } from "../../components/BackHeader";
import { Screen } from "../../components/Screen";
import { Glyph } from "../../components/art/Glyph";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// Novi's privacy policy: six promises in plain words, each one kept by a
// feature (no money held, minimum data, totals for the MFI, her record shared
// only by her, PIN and ledger protected, her rights). Same layout as
// me-agreed.tsx. Each card shows one short line, since traders scan rather
// than read; Listen reads the full wording of every promise.
const PROMISES = ["money", "data", "who", "record", "safe", "rights"] as const;

export default function MePrivacyScreen() {
  const { t } = useTranslation();
  const items = PROMISES.map((key) => ({
    key,
    title: t(`privacy.${key}Title`),
    body: t(`privacy.${key}Body`),
    detail: t(`privacy.${key}Detail`),
  }));
  const listen = [t("me.privacy"), t("privacy.intro"), ...items.map((i) => `${i.title}. ${i.detail}`)].join(". ");

  return (
    <Screen>
      <BackHeader listenText={listen} />
      <Text style={[type.display, styles.indigo]}>{t("me.privacy")}</Text>
      <Text style={styles.intro}>{t("privacy.intro")}</Text>
      <View style={styles.list}>
        {items.map((item) => (
          <View key={item.key} style={styles.item}>
            <Glyph name="check" color={colors.paid} />
            <View style={styles.texts}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.text}>{item.body}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.version}>{t("privacy.version")}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  indigo: { color: colors.indigo },
  intro: { ...type.body, color: colors.ink },
  list: { gap: 12 },
  item: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  texts: { flex: 1, gap: 4 },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, lineHeight: 23, color: colors.indigo },
  text: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.ink },
  version: { ...type.small, color: colors.ink, opacity: 0.7 },
});
