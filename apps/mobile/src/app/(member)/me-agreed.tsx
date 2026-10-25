import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { BackHeader } from "../../components/BackHeader";
import { Screen } from "../../components/Screen";
import { Glyph } from "../../components/art/Glyph";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// What she agreed to at sign-up, in the same words she accepted (the consent
// screen), so she can read them again at any time.
const AGREED = ["consent.idCheck", "consent.creditUse", "consent.terms"];

export default function MeAgreedScreen() {
  const { t } = useTranslation();
  const texts = AGREED.map((key) => t(key));

  return (
    <Screen>
      <BackHeader listenText={`${t("me.agreed")}. ${texts.join(". ")}`} />
      <Text style={[type.display, styles.indigo]}>{t("me.agreed")}</Text>
      <View style={styles.list}>
        {texts.map((text) => (
          <View key={text} style={styles.item}>
            <Glyph name="check" color={colors.paid} />
            <Text style={styles.text}>{text}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  indigo: { color: colors.indigo },
  list: { gap: 12 },
  item: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    padding: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
  },
  text: { flex: 1, fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.ink },
});
