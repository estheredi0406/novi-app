import { router } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { login, trustDevice, verifyCode } from "../api/auth";
import { ApiError, errorKey } from "../api/client";
import { ErrorMessage } from "../components/ErrorMessage";
import { Field } from "../components/Field";
import { ListenButton } from "../components/ListenButton";
import { PrimaryButton } from "../components/PrimaryButton";
import { Screen } from "../components/Screen";
import { formatPhone, formatSeconds } from "../lib/format";
import { useSession } from "../session/SessionProvider";
import { colors } from "../theme/colors";
import { fonts, type } from "../theme/typography";
import { PilotCode } from "../components/PilotCode";

// The three things this screen can show:
// - pin: she types her PIN (and her number, on a phone Novi does not know)
// - locked: 5 wrong PINs; a countdown until she may try again (D18)
// - code: a new phone; the SMS code proves she holds the SIM before it is trusted
type Mode = { kind: "pin" } | { kind: "locked"; seconds: number } | { kind: "code"; challengeId: string };

// Screens A7, A8 and the new-phone check. One file, because the PIN she
// typed must stay in memory between the steps and never leave this screen.
export default function LoginScreen() {
  const { t } = useTranslation();
  const session = useSession();
  // The number saved on this phone, unless she chose "Use another number".
  const [knownPhone, setKnownPhone] = useState(session.phone);
  const [digits, setDigits] = useState("");
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<Mode>({ kind: "pin" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const phone = knownPhone ?? `+228${digits}`;
  const phoneComplete = knownPhone !== null || /^\d{8}$/.test(digits);

  // Counts down while locked, then lets her try again.
  useEffect(() => {
    if (mode.kind !== "locked") return;
    if (mode.seconds <= 0) {
      setMode({ kind: "pin" });
      return;
    }
    const timer = setTimeout(() => setMode({ kind: "locked", seconds: mode.seconds - 1 }), 1000);
    return () => clearTimeout(timer);
  }, [mode]);

  async function submitPin(value: string) {
    setBusy(true);
    setError(null);
    try {
      const auth = await login(phone, value);
      await session.open(auth, phone);
      router.replace("/home");
    } catch (err) {
      if (err instanceof ApiError && err.code === "PIN_LOCKED") {
        setPin("");
        setMode({ kind: "locked", seconds: err.retryAfterSec ?? 900 });
      } else if (err instanceof ApiError && err.code === "NEW_DEVICE" && err.challengeId) {
        // The PIN was right; it stays in memory for the next step.
        setMode({ kind: "code", challengeId: err.challengeId });
      } else {
        setPin("");
        setError(errorKey(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmPhone(challengeId: string, value: string) {
    setBusy(true);
    setError(null);
    try {
      const { verificationToken } = await verifyCode(challengeId, value);
      const auth = await trustDevice(verificationToken, pin);
      await session.open(auth, phone);
      router.replace("/home");
    } catch (err) {
      setCode("");
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  function onPinChange(value: string) {
    const next = value.replace(/\D/g, "").slice(0, 4);
    setPin(next);
    if (next.length === 4 && phoneComplete) void submitPin(next);
  }

  function onCodeChange(challengeId: string, value: string) {
    const next = value.replace(/\D/g, "").slice(0, 6);
    setCode(next);
    if (next.length === 6) void confirmPhone(challengeId, next);
  }

  // ---------- Locked ----------
  if (mode.kind === "locked") {
    return (
      <Screen dark>
        <View style={styles.top}>
          <ListenButton text={`${t("locked.title")}. ${t("locked.lede")} ${t("locked.longer")}`} />
        </View>
        <View style={styles.center}>
          <Text style={[type.display, styles.onDark, styles.centerText]}>{t("locked.title")}</Text>
          <Text style={[type.body, styles.onDarkMuted, styles.centerText]}>{t("locked.lede")}</Text>
          <Text style={[type.small, styles.onDarkMuted]}>{t("locked.tryAgainIn")}</Text>
          <Text style={styles.countdown}>{formatSeconds(mode.seconds)}</Text>
          <Pressable accessibilityRole="link" onPress={() => router.push("/forgot-pin")} style={styles.linkButton}>
            <Text style={styles.darkLink}>{t("locked.reset")}</Text>
          </Pressable>
        </View>
        <Text style={[type.small, styles.onDarkMuted, styles.centerText]}>{t("locked.longer")}</Text>
      </Screen>
    );
  }

  // ---------- New phone: SMS code ----------
  if (mode.kind === "code") {
    const { challengeId } = mode;
    return (
      <Screen>
        <View style={styles.top}>
          <ListenButton text={`${t("newDevice.title")}. ${t("newDevice.lede", { phone: formatPhone(phone) })}`} />
        </View>
        <PilotCode />
        <View style={styles.intro}>
          <Text style={[type.display, styles.indigo]}>{t("newDevice.title")}</Text>
          <Text style={[type.body, styles.muted]}>{t("newDevice.lede", { phone: formatPhone(phone) })}</Text>
        </View>
        <Field
          label={t("newDevice.codeLabel")}
          value={code}
          onChangeText={(value) => onCodeChange(challengeId, value)}
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

  // ---------- PIN ----------
  const title = knownPhone && session.displayName ? t("unlock.greeting", { name: session.displayName }) : t("login.title");
  const lede = knownPhone ? t("unlock.lede") : t("login.lede");

  return (
    <Screen>
      <View style={styles.top}>
        <ListenButton text={`${title}. ${lede} ${t("unlock.lockWarning")}`} />
      </View>

      <View style={styles.intro}>
        <Text style={[type.display, styles.indigo]}>{title}</Text>
        <Text style={[type.body, styles.muted]}>{lede}</Text>
      </View>

      {knownPhone ? (
        <Text style={[type.title, styles.ink]}>{formatPhone(knownPhone)}</Text>
      ) : (
        <Field
          label={t("phone.label")}
          prefix="+228"
          value={digits}
          onChangeText={(value) => setDigits(value.replace(/\D/g, "").slice(0, 8))}
          keyboardType="number-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          maxLength={8}
        />
      )}

      <Field
        label={t("login.pinLabel")}
        value={pin}
        onChangeText={onPinChange}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={4}
        editable={!busy}
        autoFocus={knownPhone !== null}
        style={styles.pinInput}
      />

      <ErrorMessage messageKey={error} />
      <Text style={[type.small, styles.muted]}>{t("unlock.lockWarning")}</Text>

      <View style={styles.footer}>
        {knownPhone ? null : (
          <PrimaryButton
            label={t("login.submit")}
            onPress={() => void submitPin(pin)}
            disabled={!phoneComplete || pin.length !== 4 || busy}
          />
        )}
        <Pressable accessibilityRole="link" onPress={() => router.push("/forgot-pin")} style={styles.linkButton}>
          <Text style={styles.link}>{t("unlock.forgot")}</Text>
        </Pressable>
        {knownPhone ? (
          <Pressable accessibilityRole="link" onPress={() => setKnownPhone(null)} style={styles.linkButton}>
            <Text style={styles.link}>{t("login.otherNumber")}</Text>
          </Pressable>
        ) : (
          <Pressable accessibilityRole="link" onPress={() => router.replace("/language")} style={styles.linkButton}>
            <Text style={styles.link}>{t("login.newAccount")}</Text>
          </Pressable>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", justifyContent: "flex-end" },
  intro: { gap: 10 },
  center: { alignItems: "center", gap: 16, paddingTop: 32 },
  centerText: { textAlign: "center" },
  indigo: { color: colors.indigo },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  onDark: { color: colors.onDark },
  onDarkMuted: { color: colors.onDark, opacity: 0.8 },
  countdown: { fontFamily: fonts.display, fontSize: 56, color: colors.onDark },
  pinInput: { fontSize: 32, letterSpacing: 16, textAlign: "center" },
  codeInput: { fontSize: 30, letterSpacing: 10, textAlign: "center" },
  footer: { marginTop: "auto", gap: 4 },
  linkButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  link: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.action },
  // Saffron is kept for "your turn" only, so this link is underlined instead.
  darkLink: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.onDark, textDecorationLine: "underline" },
});