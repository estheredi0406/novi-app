import type { Frequency, GroupRules, PartnerMfi, PayoutOrder } from "@novi/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { errorKey } from "../api/client";
import { listMfis, type RulesInput } from "../api/groups";
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
  // D95: where the money is kept. The partners come from the API; until they
  // arrive (or if they cannot), the group keeps its MFI or gets the default.
  const [mfis, setMfis] = useState<PartnerMfi[]>([]);
  const [mfiId, setMfiId] = useState<string | undefined>(initial?.mfiId);
  useEffect(() => {
    listMfis()
      .then((list) => {
        setMfis(list);
        setMfiId((current) => current ?? list[0]?.id);
      })
      .catch(() => undefined);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amountFcfa = Number(amount);
  const complete = (!withName || name.trim().length >= 2) && amountFcfa > 0 && dueDay >= 1;

  // Switching to monthly keeps the day only if every month has it (D30).
  // A daily group pays every day but Sunday: its day is stored as 1 (D92).
  function chooseFrequency(next: Frequency) {
    setFrequency(next);
    if (next === "DAILY") setDueDay(1);
    else if (frequency === "DAILY") setDueDay(5);
    else if (next === "WEEKLY" && dueDay > 7) setDueDay(5);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), amountFcfa, frequency, dueDay, size, payoutOrder, mfiId });
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
          <Chip label={t("rules.daily")} selected={frequency === "DAILY"} onPress={() => chooseFrequency("DAILY")} />
          <Chip label={t("rules.weekly")} selected={frequency === "WEEKLY"} onPress={() => chooseFrequency("WEEKLY")} />
          <Chip label={t("rules.monthly")} selected={frequency === "MONTHLY"} onPress={() => chooseFrequency("MONTHLY")} />
        </View>
      </View>

      {frequency === "DAILY" ? (
        <Text style={styles.hint}>{t("rules.dailyHint")}</Text>
      ) : frequency === "WEEKLY" ? (
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

      {mfis.length > 0 ? (
        <View style={styles.group}>
          <Text style={styles.label}>{t("rules.mfiLabel")}</Text>
          <View style={styles.chips}>
            {mfis.map((m) => (
              <Chip key={m.id} label={m.name} selected={mfiId === m.id} onPress={() => setMfiId(m.id)} />
            ))}
          </View>
          <Text style={[type.small, styles.muted]}>{t("rules.mfiHint")}</Text>
        </View>
      ) : null}

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
  hint: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  muted: { color: colors.muted },
  ink: { color: colors.ink },
  note: { padding: 16, borderRadius: 14, backgroundColor: colors.mist },
});
