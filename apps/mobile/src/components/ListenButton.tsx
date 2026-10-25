import * as Speech from "expo-speech";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";

// Reads the screen aloud, for members who prefer listening to reading.
// French and English use the phone's voice; Ewe uses French until recordings
// by a native speaker exist, as the brief plans. Cotton pill with a navy
// outline, so it stays readable on lavender and on the orange leaves.
export function ListenButton({ text }: { text: string }) {
  const { t, i18n } = useTranslation();

  function listen() {
    void Speech.stop();
    Speech.speak(text, { language: i18n.language === "en" ? "en-US" : "fr-FR", rate: 0.9 });
  }

  return (
    <Pressable accessibilityRole="button" onPress={listen} style={styles.button}>
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path
          d="M5 9v6h4l5 4V5L9 9H5z M17 9a4 4 0 0 1 0 6"
          stroke={colors.indigo}
          strokeWidth={2.4}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <Text style={styles.label}>{t("common.listen")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.shell,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  label: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.indigo },
});
