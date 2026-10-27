import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { AuthBand } from "../../components/AuthBand";
import { useSignUp } from "../../signup/SignUpContext";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// The demo's partner MFI. Comes from the group's MFI once groups exist (Sprint 2).
const MFI_NAME = "FUCEC-Togo";

// Screen A11: identity could not be confirmed. No account was created; she is
// sent to her MFI, which can check her card in person (D12).
export default function NotVerifiedScreen() {
  const { t } = useTranslation();
  const { reset } = useSignUp();

  function restart() {
    reset();
    router.replace("/language");
  }

  return (
    <Screen
      top={
        <AuthBand
          title={t("notVerified.title")}
          lede={t("notVerified.lede")}
          listenText={`${t("notVerified.title")}. ${t("notVerified.lede")} ${t("notVerified.bring")}`}
        />
      }
    >
      <View style={styles.card}>
        <Text style={styles.eyebrow}>{t("notVerified.visit")}</Text>
        <Text style={[type.title, styles.ink]}>{MFI_NAME}</Text>
        <Text style={[type.body, styles.muted]}>{t("notVerified.bring")}</Text>
      </View>

      <View style={styles.note}>
        <Text style={[type.small, styles.ink]}>{t("notVerified.nothingSaved")}</Text>
      </View>

      <PrimaryButton label={t("notVerified.restart")} onPress={restart} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 10 },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
  ink: { color: colors.ink },
  eyebrow: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.action },
  card: { gap: 8, padding: 18, borderRadius: 18, borderWidth: 1.5, borderColor: colors.indigo, backgroundColor: colors.card },
  note: { padding: 16, borderRadius: 14, backgroundColor: colors.mist },
});