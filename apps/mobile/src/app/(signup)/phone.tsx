import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { requestCode } from "../../api/auth";
import { errorKey } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Field } from "../../components/Field";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { AuthBand } from "../../components/AuthBand";
import { currentLanguage } from "../../i18n";
import { useSignUp } from "../../signup/SignUpContext";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// Screen A2: her phone number. Novi sends a 6-digit code to prove she holds the SIM.
export default function PhoneScreen() {
  const { t } = useTranslation();
  const { update } = useSignUp();
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isComplete = /^\d{8}$/.test(digits);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const phone = `+228${digits}`;
      const challenge = await requestCode(phone, "SIGN_UP", currentLanguage());
      update({ phone, challengeId: challenge.challengeId, resendInSec: challenge.resendInSec });
      router.push("/code");
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      top={
        <AuthBand
          step={1}
          eyebrow={t("phone.step")}
          title={t("phone.title")}
          listenText={`${t("phone.title")}. ${t("phone.safety")}`}
        />
      }
    >
      <Field
        label={t("phone.label")}
        prefix="+228"
        value={digits}
        onChangeText={(value) => setDigits(value.replace(/\D/g, "").slice(0, 8))}
        keyboardType="number-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        maxLength={8}
        autoFocus
      />

      <View style={styles.note}>
        <Text style={[type.small, styles.ink]}>{t("phone.safety")}</Text>
      </View>

      <ErrorMessage messageKey={error} />
      <PrimaryButton label={t("phone.send")} onPress={() => void sendCode()} disabled={!isComplete || busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 10 },
  eyebrow: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.action },
  indigo: { color: colors.indigo },
  ink: { color: colors.ink },
  note: { padding: 16, borderRadius: 14, backgroundColor: colors.mist },
});