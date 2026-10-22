import type { Frequency, GroupRules, PayoutOrder } from "@novi/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { errorKey } from "../api/client";
import type { RulesInput } from "../api/groups";
import { formatFcfa } from "../lib/format";
import { colors } from "../theme/colors";
import { fonts, type } from "../theme/typography";
import { Chip } from "./Chip";
import { ErrorMessage } from "./ErrorMessage";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const SIZES = Array.from({ length: 13 }, (_, i) => i + 3); // 3 to 15 (D28)

export type RulesFormValues = RulesInput & { name: string };

// The rules of a group, used to create one and to change its rules. The app
// checks only what it must to enable the button; the API's rules engine
// decides what is allowed and answers in her language (D32).
export function RulesForm({
  initial,
  withName,
  submitLabel,
  onSubmit,
}: {
  initial?: GroupRules & { name?: string };
  withName: boolean;
  submitLabel: string;
  onSubmit: (values: RulesFormValues) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.amountFcfa) : "");
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? "WEEKLY");
  const [dueDay, setDueDay] = useState(initial?.dueDay ?? 5);
  const [size, setSize] = useState(initial?.size ?? 10);
  const [payoutOrder, setPayoutOrder] = useState<PayoutOrder>(initial?.payoutOrder ?? "DRAWN");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amountFcfa = Number(amount);
  const complete = (!withName || name.trim().length >= 2) && amountFcfa > 0 && dueDay >= 1;

  // Switching to monthly keeps the day only if every month has it (D30).
  function chooseFrequency(next: Frequency) {
    setFrequency(next);
    if (next === "WEEKLY" && dueDay > 7) setDueDay(5);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), amountFcfa, frequency, dueDay, size, payoutOrder });
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      {withName ? (
        <Field label={t("rules.name")} value={name} onChangeText={setName} maxLength={60} placeholder={t("rules.namePlaceholder")} />
      ) : null}

      <Field
        label={t("rules.amountLabel")}
        prefix="FCFA"
        value={amount}
        onChangeText={(value) => setAmount(value.replace(/\D/g, "").slice(0, 7))}
        keyboardType="number-pad"
        placeholder="5000"
      />

      <View style={styles.group}>
        <Text style={styles.label}>{t("rules.frequencyLabel")}</Text>
        <View style={styles.chips}>
          <Chip label={t("rules.weekly")} selected={frequency === "WEEKLY"} onPress={() => chooseFrequency("WEEKLY")} />
          <Chip label={t("rules.monthly")} selected={frequency === "MONTHLY"} onPress={() => chooseFrequency("MONTHLY")} />
        </View>
      </View>

      {frequency === "WEEKLY" ? (
        <View style={styles.group}>
          <Text style={styles.label}>{t("rules.weekdayLabel")}</Text>
          <View style={styles.chips}>
            {WEEKDAYS.map((day) => (
              <Chip key={day} label={t(`days.${day}`)} selected={dueDay === day} onPress={() => setDueDay(day)} />
            ))}
          </View>
        </View>
      ) : (
        <Field
          label={t("rules.monthDayLabel")}
          value={dueDay > 0 ? String(dueDay) : ""}
          onChangeText={(value) => setDueDay(Number(value.replace(/\D/g, "").slice(0, 2)))}
          keyboardType="number-pad"
        />
      )}

      <View style={styles.group}>
        <Text style={styles.label}>{t("rules.sizeLabel")}</Text>
        <View style={styles.chips}>
          {SIZES.map((n) => (
            <Chip key={n} label={String(n)} selected={size === n} onPress={() => setSize(n)} />
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>{t("rules.orderLabel")}</Text>
        <View style={styles.chips}>
          <Chip label={t("rules.orderDrawn")} selected={payoutOrder === "DRAWN"} onPress={() => setPayoutOrder("DRAWN")} />
          <Chip label={t("rules.orderFixed")} selected={payoutOrder === "FIXED"} onPress={() => setPayoutOrder("FIXED")} />
        </View>
        <Text style={[type.small, styles.muted]}>
          {payoutOrder === "DRAWN" ? t("rules.orderDrawnHint") : t("rules.orderFixedHint")}
        </Text>
      </View>

      {amountFcfa > 0 ? (
        <View style={styles.note}>
          <Text style={[type.body, styles.ink]}>{t("rules.potHint", { pot: formatFcfa(amountFcfa * size) })}</Text>
        </View>
      ) : null}

      <ErrorMessage messageKey={error} />
      <PrimaryButton label={submitLabel} onPress={() => void submit()} disabled={!complete || busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 20 },
  group: { gap: 10 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  muted: { color: colors.muted },
  ink: { color: colors.ink },
  note: { padding: 16, borderRadius: 14, backgroundColor: colors.mist },
});
