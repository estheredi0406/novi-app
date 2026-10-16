import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";

// Shows an error in her language from its message key. Mist and indigo,
// not red: red is kept for money problems (D21).
export function ErrorMessage({ messageKey }: { messageKey: string | null }) {
  const { t } = useTranslation();
  if (!messageKey) return null;

  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.box}>
      <Text style={styles.text}>{t(messageKey)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: 16, borderRadius: 14, backgroundColor: colors.mist },
  text: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 22, color: colors.indigo },
});