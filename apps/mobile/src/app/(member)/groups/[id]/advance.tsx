import type { GroupHelp } from "@novi/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../../../api/client";
import { askAdvance, getHelp } from "../../../../api/help";
import { BackHeader } from "../../../../components/BackHeader";
import { ErrorMessage } from "../../../../components/ErrorMessage";
import { Field } from "../../../../components/Field";
import { PrimaryButton } from "../../../../components/PrimaryButton";
import { Screen } from "../../../../components/Screen";
import { formatFcfa } from "../../../../lib/format";
import { colors } from "../../../../theme/colors";
import { type } from "../../../../theme/typography";

// D88: a small advance from the solidarity fund, for an emergency. Up to one
// contribution; the organiser and one member approve; FUCEC sends it; her
// own pot repays it on her turn, with no interest.
export default function AdvanceScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [help, setHelp] = useState<GroupHelp | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getHelp(id).then(
      (h) => {
        setHelp(h);
        setAmount(String(h.advanceMaxFcfa));
      },
      (err: unknown) => setError(errorKey(err)),
    );
  }, [id]);

  const value = Number(amount.replace(/\D/g, ""));
  const max = help?.advanceMaxFcfa ?? 0;
  const valid = value >= 500 && value <= max;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await askAdvance(id, value, reason);
      router.back();
    } catch (err) {
      setError(errorKey(err));
      setBusy(false);
    }
  }

  return (
    <Screen>
      <BackHeader
        listenText={`${t("help.advanceCta")}. ${t("help.advanceIntro")}`}
      />
      <View style={styles.intro}>
        <Text style={[type.title, styles.indigo]}>{t("help.advanceCta")}</Text>
        <Text style={[type.body, styles.muted]}>{t("help.advanceIntro")}</Text>
      </View>
      <Field
        label={t("help.amountLabel", { max: formatFcfa(max) })}
        value={amount}
        onChangeText={setAmount}
        keyboardType="number-pad"
        maxLength={7}
        prefix="FCFA"
      />
      <Field
        label={t("help.reasonLabel")}
        value={reason}
        onChangeText={setReason}
        maxLength={140}
        placeholder={t("help.reasonPlaceholder")}
      />
      <View style={styles.facts}>
        <Text style={[type.small, styles.ink]}>✓ {t("help.factApproval")}</Text>
        <Text style={[type.small, styles.ink]}>✓ {t("help.factRepay")}</Text>
        <Text style={[type.small, styles.ink]}>
          ✓ {t("help.factNoInterest")}
        </Text>
      </View>
      <ErrorMessage messageKey={error} />
      <PrimaryButton
        label={t("help.send")}
        onPress={() => void send()}
        disabled={busy || !valid}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 8 },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
  ink: { color: colors.ink },
  facts: {
    gap: 6,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.mist,
  },
});
