import * as Speech from "expo-speech";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text } from "react-native";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";

// Reads the screen aloud, for members who prefer listening to reading.
// French and English use the phone's voice; Ewe uses French until recordings
// by a native speaker exist, as the brief plans.
export function ListenButton({ text }: { text: string }) {
  const { t, i18n } = useTranslation();

  function listen() {
    void Speech.stop();
    Speech.speak(text, { language: i18n.language === "en" ? "en-US" : "fr-FR", rate: 0.9 });
  }

  return (
    <Pressable accessibilityRole="button" onPress={listen} style={styles.button}>
      <Text style={styles.label}>{t("common.listen")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: colors.mist,
    justifyContent: "center",
  },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.indigo },
});