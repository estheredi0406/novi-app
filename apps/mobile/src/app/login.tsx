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
import { AuthBand } from "../components/AuthBand";
import { PinBoxes } from "../components/PinBoxes";
import { NoviMark } from "../components/art/NoviMark";

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
          <NoviMark size={96} />
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
      <Screen
        top={
          <AuthBand
            title={t("newDevice.title")}
            lede={t("newDevice.lede", { phone: formatPhone(phone) })}
            listenText={`${t("newDevice.title")}. ${t("newDevice.lede", { phone: formatPhone(phone) })}`}
          />
        }
      >
        <PilotCode />
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

  // ---------- PIN (approved design, 27 Oct) ----------
  // On her own phone: her account in a card, so she sees why the number is
  // there, with "Changer" to use another. On a new phone: a classic form.
  const returning = knownPhone !== null;
  const title = returning && session.displayName ? t("unlock.greeting", { name: session.displayName }) : t("login.title");
  const lede = returning ? t("unlock.lede") : t("login.lede");

  return (
    <Screen
      top={
        <AuthBand mark={returning} title={title} lede={lede} listenText={`${title}. ${lede} ${t("unlock.lockWarning")}`} />
      }
    >
      {returning ? (
        <View style={styles.accountWrap}>
          <View style={styles.accountShadow} />
          <View style={styles.account}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{(session.displayName ?? "N").charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.accountText}>
              <Text style={styles.accountLabel}>{t("login.accountOnPhone")}</Text>
              <Text style={styles.accountPhone}>{maskPhone(knownPhone)}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setKnownPhone(null)} style={styles.change}>
              <Text style={styles.link}>{t("login.change")}</Text>
            </Pressable>
          </View>
        </View>
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

      <View>
        <PinBoxes
          label={t("login.pinLabel")}
          value={pin}
          onChangeText={onPinChange}
          editable={!busy}
          autoFocus={returning}
        />
        <Pressable accessibilityRole="link" onPress={() => router.push("/forgot-pin")} style={styles.forgot}>
          <Text style={styles.link}>{t("unlock.forgot")}</Text>
        </Pressable>
      </View>

      <ErrorMessage messageKey={error} />
      <PrimaryButton
        label={returning ? t("unlock.open") : t("login.submit")}
        onPress={() => void submitPin(pin)}
        disabled={!phoneComplete || pin.length !== 4 || busy}
      />
      <Text style={[type.small, styles.muted]}>{t("unlock.lockWarning")}</Text>

      {returning ? null : (
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {t("login.noAccount")}{" "}
            <Text accessibilityRole="link" onPress={() => router.replace("/phone")} style={styles.footerLink}>
              {t("login.createAccount")}
            </Text>
          </Text>
        </View>
      )}
    </Screen>
  );
}

// "+22890000001" becomes "+228 90 •• •• 01": enough for her to recognise
// her number, not enough for someone looking over her shoulder.
function maskPhone(phone: string): string {
  const d = phone.replace("+228", "");
  return `+228 ${d.slice(0, 2)} •• •• ${d.slice(6, 8)}`;
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
  phone: {
    fontFamily: fonts.bodyBold,
    fontSize: 22,
    color: colors.indigo,
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  codeInput: { fontSize: 30, letterSpacing: 10, textAlign: "center" },
  footer: { marginTop: "auto", alignItems: "center", paddingTop: 8 },
  footerText: { fontFamily: fonts.body, fontSize: 15, color: colors.muted, textAlign: "center" },
  footerLink: { fontFamily: fonts.bodyBold, color: colors.indigo, textDecorationLine: "underline" },
  forgot: { alignSelf: "flex-end", minHeight: 44, justifyContent: "center" },
  accountWrap: { paddingRight: 4, paddingBottom: 4 },
  accountShadow: {
    position: "absolute",
    top: 4,
    left: 4,
    right: 0,
    bottom: 0,
    borderRadius: 18,
    backgroundColor: colors.indigo,
  },
  account: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.mist,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: fonts.display, fontSize: 22, color: colors.indigo },
  accountText: { flex: 1, gap: 2 },
  accountLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  accountPhone: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink },
  change: { minHeight: 44, justifyContent: "center" },
  linkButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  link: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.action },
  // Saffron is kept for "your turn" only, so this link is underlined instead.
  darkLink: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.onDark, textDecorationLine: "underline" },
});