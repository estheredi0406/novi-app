import { Redirect, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { AuthBand } from "../../components/AuthBand";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { TextButton } from "../../components/TextButton";
import { useSignUp } from "../../signup/SignUpContext";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// D132: after the ANID code, the name on her identity record for her to confirm
// (D106). That is the name the MFI uses. "Non" restarts the step, nothing kept.
export default function IdentityConfirmScreen() {
  const { t } = useTranslation();
  const { draft, update } = useSignUp();
  if (!draft.identityToken || !draft.legalName) return <Redirect href="/identity" />;

  function notMe() {
    update({ identityToken: undefined, legalName: undefined, pendingToken: undefined });
    router.replace("/identity");
  }

  return (
    <Screen
      top={
        <AuthBand
          step={4}
          eyebrow={t("idConfirm.step")}
          title={t("idConfirm.title")}
          listenText={`${t("idConfirm.title")}. ${draft.legalName}. ${t("idConfirm.question")}`}
        />
      }
    >
      <View style={styles.card}>
        <Text style={styles.name}>{draft.legalName}</Text>
        <Text style={styles.question}>{t("idConfirm.question")}</Text>
      </View>
      <Text style={[type.small, styles.muted]}>{t("idConfirm.note")}</Text>
      <View style={styles.grow} />
      <PrimaryButton label={t("idConfirm.yes")} onPress={() => router.push("/pin")} />
      <TextButton label={t("idConfirm.no")} onPress={notMe} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6, padding: 20, borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  name: { fontFamily: fonts.display, fontSize: 26, lineHeight: 34, color: colors.indigo },
  question: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  muted: { color: colors.muted },
  grow: { flexGrow: 1, minHeight: 8 },
});
