import { Redirect, router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { confirmIdentityCheck } from "../../api/auth";
import { ApiError, errorKey } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Field } from "../../components/Field";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { StepHeader } from "../../components/StepHeader";
import { useSignUp } from "../../signup/SignUpContext";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// Screen A6: the code ANID sent to the phone on her ID record. Proves she owns this identity.
export default function AnidCodeScreen() {
  const { t } = useTranslation();
  const { draft, update } = useSignUp();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mustRestart, setMustRestart] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!draft.verificationToken || !draft.pendingToken) return <Redirect href="/identity" />;
  const { verificationToken, pendingToken } = draft;

  async function check(value: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await confirmIdentityCheck(verificationToken, pendingToken, value);
      update({ identityToken: result.identityToken, legalName: result.legalName });
      router.push("/pin");
    } catch (err) {
      setCode("");
      if (err instanceof ApiError && err.code === "ID_BLOCKED") {
        router.replace("/not-verified");
        return;
      }
      if (err instanceof ApiError && err.code === "ID_CODE_EXPIRED") setMustRestart(true);
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  function onChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void check(digits);
  }

  const sentTo = t("anidCode.sentTo", { phone: draft.maskedPhone ?? "" });

  return (
    <Screen>
      <StepHeader step={4} listenText={`${t("anidCode.title")}. ${sentTo}`} />

      <View style={styles.intro}>
        <Text style={[type.display, styles.indigo]}>{t("anidCode.title")}</Text>
        <Text style={[type.body, styles.muted]}>{sentTo}</Text>
      </View>

      {mustRestart ? null : (
        <Field
          label={t("anidCode.title")}
          value={code}
          onChangeText={onChange}
          keyboardType="number-pad"
          maxLength={6}
          editable={!busy}
          autoFocus
          style={styles.codeInput}
        />
      )}

      <ErrorMessage messageKey={error} />

      {mustRestart ? (
        <PrimaryButton label={t("anidCode.restart")} onPress={() => router.back()} />
      ) : (
        <View style={styles.note}>
          <Text style={[type.small, styles.ink]}>{t("anidCode.notYourPhone")}</Text>
          <Pressable accessibilityRole="link" onPress={() => router.push("/not-verified")}>
            <Text style={styles.link}>{t("anidCode.seeOther")}</Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 10 },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
  ink: { color: colors.ink },
  codeInput: { fontSize: 30, letterSpacing: 10, textAlign: "center" },
  note: { gap: 10, padding: 16, borderRadius: 14, backgroundColor: colors.mist },
  link: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.action },
});