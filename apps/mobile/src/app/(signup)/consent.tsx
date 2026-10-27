import { Redirect, router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { AuthBand } from "../../components/AuthBand";
import { useSignUp } from "../../signup/SignUpContext";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// The three agreements, in the order she reads them. Each one matches a rule
// the API enforces: no ID check without the first, no account without the
// other two (CONSENT_REQUIRED).
const AGREEMENTS = [
  { field: "consentToIdCheck", textKey: "consent.idCheck" },
  { field: "acceptedCreditDataUse", textKey: "consent.creditUse" },
  { field: "acceptedTerms", textKey: "consent.terms" },
] as const;

type AgreementField = (typeof AGREEMENTS)[number]["field"];

// Screen A6: her agreement before Novi asks ANID about her. Nothing is sent
// from here; the answers wait in the sign-up draft until the next steps.
export default function ConsentScreen() {
  const { t } = useTranslation();
  const { draft, update } = useSignUp();

  // Starts from what she already ticked, so going back and forth keeps her answers.
  const [ticked, setTicked] = useState<Record<AgreementField, boolean>>({
    consentToIdCheck: draft.consentToIdCheck ?? false,
    acceptedCreditDataUse: draft.acceptedCreditDataUse ?? false,
    acceptedTerms: draft.acceptedTerms ?? false,
  });

  // Arriving here without a verified phone (for example after a reload) starts again.
  if (!draft.verificationToken) return <Redirect href="/phone" />;

  const allTicked = AGREEMENTS.every(({ field }) => ticked[field]);

  function toggle(field: AgreementField) {
    setTicked((current) => ({ ...current, [field]: !current[field] }));
  }

  function next() {
    update(ticked);
    router.push("/identity");
  }

  return (
    <Screen
      top={
        <AuthBand
          step={3}
          eyebrow={t("consent.step")}
          title={t("consent.title")}
          lede={t("consent.lede")}
          listenText={[t("consent.title"), t("consent.lede"), ...AGREEMENTS.map(({ textKey }) => t(textKey))].join(". ")}
        />
      }
    >
      <View style={styles.list}>
        {AGREEMENTS.map(({ field, textKey }) => {
          const isTicked = ticked[field];
          return (
            <Pressable
              key={field}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isTicked }}
              onPress={() => toggle(field)}
              style={[styles.row, isTicked && styles.rowTicked]}
            >
              <View style={[styles.box, isTicked && styles.boxTicked]}>
                {isTicked ? <Text style={styles.tick}>✓</Text> : null}
              </View>
              <Text style={[type.body, styles.ink, styles.rowText]}>{t(textKey)}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.footer}>
        <Text style={[type.small, styles.muted, styles.center]}>{t("consent.nothingSent")}</Text>
        <PrimaryButton label={t("common.continue")} onPress={next} disabled={!allTicked} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 10 },
  eyebrow: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.action },
  indigo: { color: colors.indigo },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  center: { textAlign: "center" },
  list: { gap: 12 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    minHeight: 64,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
  },
  rowTicked: { borderColor: colors.accent, borderWidth: 2.5, backgroundColor: colors.mist },
  box: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  boxTicked: { borderColor: colors.indigo, backgroundColor: colors.accent },
  tick: { color: colors.white, fontFamily: fonts.bodyBold, fontSize: 18, lineHeight: 22 },
  rowText: { flex: 1 },
  footer: { marginTop: "auto", gap: 12 },
});