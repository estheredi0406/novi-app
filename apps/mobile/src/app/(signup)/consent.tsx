import { useTranslation } from "react-i18next";
import { StyleSheet, Text } from "react-native";
import { Screen } from "../../components/Screen";
import { StepHeader } from "../../components/StepHeader";
import { colors } from "../../theme/colors";
import { type } from "../../theme/typography";

// Placeholder proving the SMS step reached here. The full consent screen
// replaces it in part 2.
export default function ConsentScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <StepHeader step={3} listenText={t("consent.title")} />
      <Text style={[type.display, styles.indigo]}>{t("consent.title")}</Text>
      <Text style={[type.body, styles.ink]}>{t("consent.lede")}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  indigo: { color: colors.indigo },
  ink: { color: colors.ink },
});