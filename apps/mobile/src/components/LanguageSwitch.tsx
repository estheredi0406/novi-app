import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { updateProfile } from "../api/auth";
import { APP_LANGUAGES, type AppLanguage, currentLanguage, setAppLanguage } from "../i18n";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { Chip } from "./Chip";

const LANGUAGES = APP_LANGUAGES;

// Changes the language of the app at once, and of her account, so the SMS
// Novi sends her (codes, invitations, receipts) follow the same choice.
export function LanguageSwitch() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(currentLanguage());

  function choose(language: AppLanguage) {
    setSelected(language);
    setAppLanguage(language);
    // If the account cannot be updated now (no connection), the app still
    // changes; her SMS follow the next time she changes it with a connection.
    updateProfile({ language }).catch(() => undefined);
  }

  return (
    <View style={styles.box}>
      <Text style={styles.label}>{t("home.language")}</Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {LANGUAGES.map(({ language, nameKey }) => (
          <Chip key={language} label={t(nameKey)} selected={selected === language} onPress={() => choose(language)} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
