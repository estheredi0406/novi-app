import { Redirect, router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { startIdentityCheck } from "../../api/auth";
import { ApiError, errorKey } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Field } from "../../components/Field";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { StepHeader } from "../../components/StepHeader";
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

  if (!draft.verificationToken) return <Redirect href="/phone" />;
  const { verificationToken } = draft;

  const dateOfBirth = toIsoDate(day, month, year);
  const isComplete = niu.trim().length > 0 && legalName.trim().length >= 2 && dateOfBirth !== null;

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
    <Screen>
      <StepHeader step={4} listenText={`${t("idDetails.title")}. ${t("idDetails.nameHint")}`} />

      <View style={styles.intro}>
        <Text style={styles.eyebrow}>{t("idDetails.step")}</Text>
        <Text style={[type.display, styles.indigo]}>{t("idDetails.title")}</Text>
      </View>

      {__DEV__ ? (
        <View style={styles.demo}>
          <Text style={[type.small, styles.ink]}>Demo record: TEST-0001 · AKOSSIWA AFI MENSAH · 12 03 1984</Text>
        </View>
      ) : null}

      <Field label={t("idDetails.niu")} value={niu} onChangeText={setNiu} autoCapitalize="characters" autoCorrect={false} />
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
            <Field label={t("idDetails.day")} value={day} onChangeText={(v) => setDay(v.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={2} />
          </View>
          <View style={styles.dobSmall}>
            <Field label={t("idDetails.month")} value={month} onChangeText={(v) => setMonth(v.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={2} />
          </View>
          <View style={styles.dobLarge}>
            <Field label={t("idDetails.year")} value={year} onChangeText={(v) => setYear(v.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={4} />
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