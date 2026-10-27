import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { requestCode, verifyCode } from "../../api/auth";
import { errorKey } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Field } from "../../components/Field";
import { Screen } from "../../components/Screen";
import { AuthBand } from "../../components/AuthBand";
import { currentLanguage } from "../../i18n";
import { formatPhone, formatSeconds } from "../../lib/format";
import { useSignUp } from "../../signup/SignUpContext";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";
import { PilotCode } from "../../components/PilotCode";

// Screen A3: the 6-digit SMS code. Checked as soon as the sixth digit is typed.
export default function CodeScreen() {
  const { t } = useTranslation();
  const { draft, update } = useSignUp();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(draft.resendInSec ?? 60);

  // Counts down to when she may ask for a new code.
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  // Arriving here without a code request (for example after a reload) starts again.
  if (!draft.challengeId || !draft.phone) return <Redirect href="/phone" />;
  const { challengeId, phone } = draft;

  async function check(value: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await verifyCode(challengeId, value);
      update({ verificationToken: result.verificationToken });
      router.push("/consent");
    } catch (err) {
      setError(errorKey(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  function onChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void check(digits);
  }

  async function resend() {
    setError(null);
    try {
      const challenge = await requestCode(phone, "SIGN_UP", currentLanguage());
      update({ challengeId: challenge.challengeId });
      setWait(challenge.resendInSec);
    } catch (err) {
      setError(errorKey(err));
    }
  }

  return (
    <Screen
      top={
        <AuthBand
          step={2}
          eyebrow={t("code.step")}
          title={t("code.title")}
          lede={t("code.sentTo", { phone: formatPhone(phone) })}
          listenText={`${t("code.title")}. ${t("code.sentTo", { phone: formatPhone(phone) })}`}
        >
          <Pressable accessibilityRole="link" onPress={() => router.back()}>
            <Text style={styles.link}>{t("code.change")}</Text>
          </Pressable>
        </AuthBand>
      }
    >
      <PilotCode />

      <Field
        label={t("code.title")}
        value={code}
        onChangeText={onChange}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        editable={!busy}
        autoFocus
        style={styles.codeInput}
      />

      <ErrorMessage messageKey={error} />

      {wait > 0 ? (
        <Text style={[type.small, styles.muted]}>{t("code.resendIn", { time: formatSeconds(wait) })}</Text>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => void resend()} style={styles.resend}>
          <Text style={styles.link}>{t("code.resend")}</Text>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 10 },
  eyebrow: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.action },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
  link: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.action },
  codeInput: { fontSize: 30, letterSpacing: 10, textAlign: "center" },
  resend: { minHeight: 44, justifyContent: "center" },
});