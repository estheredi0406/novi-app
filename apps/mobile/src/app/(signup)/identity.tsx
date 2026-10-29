import { Redirect, router } from "expo-router";
import { type ComponentRef, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Keyboard, StyleSheet, Text, type TextInput, View } from "react-native";
import { startIdentityCheck } from "../../api/auth";
import { ApiError, errorKey } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Field } from "../../components/Field";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { AuthBand } from "../../components/AuthBand";
import { useSignUp } from "../../signup/SignUpContext";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// Builds YYYY-MM-DD from three fields, or null if it is not a real date.
function toIsoDate(day: string, month: string, year: string): string | null {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!/^\d{4}$/.test(year) || y < 1900 || y > new Date().getFullYear()) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// The NIU as she types it: digits only, with the dashes of the card's
// 4-3-4 format added as she goes (1234-234-2344).
function formatNiu(typed: string): string {
  const d = typed.replace(/\D/g, "").slice(0, 11);
  return [d.slice(0, 4), d.slice(4, 7), d.slice(7)].filter(Boolean).join("-");
}

// Screen A5: the details from her e-ID card, checked against ANID's record.
export default function IdentityScreen() {
  const { t } = useTranslation();
  const { draft, update } = useSignUp();
  const [niu, setNiu] = useState("");
  const [legalName, setLegalName] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The date moves on by itself: two digits for the day, then the month,
  // then four for the year, so she never has to close the keyboard.
  const monthRef = useRef<ComponentRef<typeof TextInput>>(null);
  const yearRef = useRef<ComponentRef<typeof TextInput>>(null);

  if (!draft.verificationToken) return <Redirect href="/phone" />;
  const { verificationToken } = draft;

  const dateOfBirth = toIsoDate(day, month, year);
  const isComplete = niu.replace(/\D/g, "").length === 11 && legalName.trim().length >= 2 && dateOfBirth !== null;

  async function check() {
    if (!dateOfBirth) return;
    setBusy(true);
    setError(null);
    try {
      const result = await startIdentityCheck({
        verificationToken,
        consentToIdCheck: draft.consentToIdCheck ?? false,
        niu: niu.trim(),
        legalName: legalName.trim(),
        dateOfBirth,
      });
      update({ pendingToken: result.pendingToken, maskedPhone: result.maskedPhone });
      router.push("/anid-code");
    } catch (err) {
      if (err instanceof ApiError && err.code === "ID_BLOCKED") {
        router.replace("/not-verified");
        return;
      }
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      top={
        <AuthBand
          step={4}
          eyebrow={t("idDetails.step")}
          title={t("idDetails.title")}
          listenText={`${t("idDetails.title")}. ${t("idDetails.nameHint")}`}
        />
      }
    >
      {__DEV__ ? (
        <View style={styles.demo}>
          <Text style={[type.small, styles.ink]}>Demo record: 0000-000-0001 · AKOSSIWA AFI MENSAH · 12 03 1984</Text>
        </View>
      ) : null}

      <Field
        label={t("idDetails.niu")}
        value={niu}
        onChangeText={(v) => setNiu(formatNiu(v))}
        keyboardType="number-pad"
        placeholder="1234-234-2344"
        maxLength={13}
        autoCorrect={false}
      />
      <Field
        label={t("idDetails.legalName")}
        value={legalName}
        onChangeText={setLegalName}
        autoCapitalize="characters"
        autoCorrect={false}
      />

      <View style={styles.dobBlock}>
        <Text style={styles.label}>{t("idDetails.dateOfBirth")}</Text>
        <View style={styles.dobRow}>
          <View style={styles.dobSmall}>
            <Field
              label={t("idDetails.day")}
              value={day}
              onChangeText={(v) => {
                const next = v.replace(/\D/g, "");
                setDay(next);
                if (next.length === 2) monthRef.current?.focus();
              }}
              keyboardType="number-pad"
              maxLength={2}
            />
          </View>
          <View style={styles.dobSmall}>
            <Field
              ref={monthRef}
              label={t("idDetails.month")}
              value={month}
              onChangeText={(v) => {
                const next = v.replace(/\D/g, "");
                setMonth(next);
                if (next.length === 2) yearRef.current?.focus();
              }}
              keyboardType="number-pad"
              maxLength={2}
            />
          </View>
          <View style={styles.dobLarge}>
            <Field
              ref={yearRef}
              label={t("idDetails.year")}
              value={year}
              onChangeText={(v) => {
                const next = v.replace(/\D/g, "");
                setYear(next);
                if (next.length === 4) Keyboard.dismiss();
              }}
              keyboardType="number-pad"
              maxLength={4}
            />
          </View>
        </View>
      </View>

      <Text style={[type.small, styles.muted]}>{t("idDetails.nameHint")}</Text>
      <ErrorMessage messageKey={error} />
      <PrimaryButton label={t("idDetails.submit")} onPress={() => void check()} disabled={!isComplete || busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 10 },
  eyebrow: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.action },
  indigo: { color: colors.indigo },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  demo: { padding: 12, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.action },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  dobBlock: { gap: 8 },
  dobRow: { flexDirection: "row", gap: 10 },
  dobSmall: { flex: 1 },
  dobLarge: { flex: 1.6 },
});
