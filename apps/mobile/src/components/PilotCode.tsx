import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { pilotCodeStore } from "../lib/pilotCode";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";

// Pilot mode (D61): shows the code that would arrive by SMS, clearly labelled,
// so a tester is never stuck waiting. Shows nothing outside the pilot.
export function PilotCode() {
  const { t } = useTranslation();
  const code = useSyncExternalStore(pilotCodeStore.subscribe, pilotCodeStore.get);
  if (!code) return null;

  return (
    <View accessibilityRole="summary" style={styles.box}>
      <Text style={styles.label}>{t("pilot.label")}</Text>
      <Text style={styles.code} selectable>
        {code}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: 14, borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.indigo, gap: 4 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 14, lineHeight: 20, color: colors.indigo },
  code: { fontFamily: fonts.bodySemiBold, fontSize: 26, letterSpacing: 6, color: colors.indigo },
});
