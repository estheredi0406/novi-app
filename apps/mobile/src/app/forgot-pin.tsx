import { isWeakPin } from "@novi/shared";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { requestCode, resetPin, verifyCode } from "../api/auth";
import { ApiError, errorKey } from "../api/client";
import { ErrorMessage } from "../components/ErrorMessage";
import { Field } from "../components/Field";
import { PrimaryButton } from "../components/PrimaryButton";
import { Screen } from "../components/Screen";
import { StepHeader } from "../components/StepHeader";
import { currentLanguage } from "../i18n";
import { formatPhone } from "../lib/format";
import { useSession } from "../session/SessionProvider";
import { colors } from "../theme/colors";
import { fonts, type } from "../theme/typography";

// The steps of a PIN reset (D20):
// - phone: which number to reset
// - code: the SMS code proves she holds the SIM
// - pin: the new PIN, typed twice
// - done: the PIN is changed and every phone is logged out
type Step =
  | { kind: "phone" }
  | { kind: "code"; challengeId: string }
  | { kind: "pin"; verificationToken: string; first: string | null }
  | { kind: "done" };

// Forgotten PIN. Like the login screen, one file, so the stamp from the SMS
// step stays in memory and is never written to the phone.
export default function ForgotPinScreen() {
  const { t } = useTranslation();
  const session = useSession();
  const [digits, setDigits] = useState(session.phone?.replace("+228", "") ?? "");
  const [step, setStep] = useState<Step>({ kind: "phone" });
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const phone = `+228${digits}`;

  // The API answers the same whether or not the number has an account, so
  // nobody can use this screen to find out who uses Novi.
  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const challenge = await requestCode(phone, "PIN_RESET", currentLanguage());
      setValue("");
      setStep({ kind: "code", challengeId: challenge.challengeId });
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  async function checkCode(challengeId: string, code: string) {
    setBusy(true);
    setError(null);
    try {
      const { verificationToken } = await verifyCode(challengeId, code);
      setValue("");
      setStep({ kind: "pin", verificationToken, first: null });
    } catch (err) {
      setValue("");
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  async function savePin(verificationToken: string, newPin: string) {
    setBusy(true);
    setError(null);
    try {
      await resetPin(verificationToken, newPin);
      setStep({ kind: "done" });
    } catch (err) {
      // The stamp lasts 10 minutes and works once; after that, start again.
      if (err instanceof ApiError && err.status === 401) {
        setStep({ kind: "phone" });
      }
      setError(errorKey(err));
    } finally {
      setValue("");
      setBusy(false);
    }
  }

  function onCodeChange(challengeId: string, input: string) {
    const next = input.replace(/\D/g, "").slice(0, 6);
    setValue(next);
    if (next.length === 6) void checkCode(challengeId, next);
  }

  // Same rules as sign-up: easy PINs refused at once, then typed twice (D16).
  function onPinChange(verificationToken: string, first: string | null, input: string) {
    const next = input.replace(/\D/g, "").slice(0, 4);
    setValue(next);
    if (next.length < 4) return;

    if (first === null) {
      if (isWeakPin(next)) {
        setError("auth.pinTooWeak");
        setValue("");
        return;
      }
      setError(null);
      setValue("");
      setStep({ kind: "pin", verificationToken, first: next });
      return;
    }
    if (next !== first) {
      setError("pin.mismatch");
      setValue("");
      setStep({ kind: "pin", verificationToken, first: null });
      return;
    }
    void savePin(verificationToken, next);
  }

  // ---------- Done ----------
  if (step.kind === "done") {
    return (
      <Screen>
        <StepHeader listenText={t("reset.done")} />
        <Text style={[type.title, styles.indigo]}>{t("reset.done")}</Text>
        <View style={styles.footer}>
          <PrimaryButton label={t("reset.login")} onPress={() => router.replace("/login")} />
        </View>
      </Screen>
    );
  }

  // ---------- SMS code ----------
  if (step.kind === "code") {
    const { challengeId } = step;
    return (
      <Screen>
        <StepHeader listenText={`${t("code.title")}. ${t("code.sentTo", { phone: formatPhone(phone) })}`} />
        <View style={styles.intro}>
          <Text style={[type.display, styles.indigo]}>{t("code.title")}</Text>
          <Text style={[type.body, styles.muted]}>{t("code.sentTo", { phone: formatPhone(phone) })}</Text>
        </View>
        <Field
          label={t("code.title")}
          value={value}
          onChangeText={(input) => onCodeChange(challengeId, input)}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={6}
          editable={!busy}
          autoFocus
          style={styles.codeInput}
        />
        <ErrorMessage messageKey={error} />
      </Screen>
    );
  }

  // ---------- New PIN ----------
  if (step.kind === "pin") {
    const { verificationToken, first } = step;
    const title = first === null ? t("reset.title") : t("reset.confirmTitle");
    return (
      <Screen>
        <StepHeader listenText={`${title}. ${t("pin.tip")}`} />
        <Text style={[type.display, styles.indigo]}>{title}</Text>
        <Field
          key={first === null ? "create" : "confirm"}
          label={title}
          value={value}
          onChangeText={(input) => onPinChange(verificationToken, first, input)}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          editable={!busy}
          autoFocus
          style={styles.pinInput}
        />
        <ErrorMessage messageKey={error} />
        <View style={styles.note}>
          <Text style={[type.small, styles.ink]}>{t("pin.tip")}</Text>
        </View>
      </Screen>
    );
  }

  // ---------- Phone ----------
  return (
    <Screen>
      <StepHeader listenText={`${t("forgot.title")}. ${t("forgot.lede")}`} />
      <View style={styles.intro}>
        <Text style={[type.display, styles.indigo]}>{t("forgot.title")}</Text>
        <Text style={[type.body, styles.muted]}>{t("forgot.lede")}</Text>
      </View>
      <Field
        label={t("phone.label")}
        prefix="+228"
        value={digits}
        onChangeText={(input) => setDigits(input.replace(/\D/g, "").slice(0, 8))}
        keyboardType="number-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        maxLength={8}
      />
      <ErrorMessage messageKey={error} />
      <PrimaryButton label={t("forgot.send")} onPress={() => void sendCode()} disabled={!/^\d{8}$/.test(digits) || busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 10 },
  indigo: { color: colors.indigo },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  codeInput: { fontSize: 30, letterSpacing: 10, textAlign: "center" },
  pinInput: { fontSize: 32, letterSpacing: 16, textAlign: "center" },
  note: { padding: 16, borderRadius: 14, backgroundColor: colors.mist },
  footer: { marginTop: "auto" },
});