import type { LoanPage, LoanPurpose } from "@novi/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../api/client";
import { getLoans, requestLoan, withdrawLoan } from "../../api/help";
import { BackHeader } from "../../components/BackHeader";
import { Chip } from "../../components/Chip";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Field } from "../../components/Field";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { TextButton } from "../../components/TextButton";
import { formatDay, formatFcfa } from "../../lib/format";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

const PURPOSES: LoanPurpose[] = ["STOCK", "EQUIPMENT", "OTHER"];
const MONTHS = [3, 6, 12];

// D89: "Crédit FUCEC". Her record opens the door: the conditions, ticked or
// not; when they are all met, the request (amount, what for, how long). The
// MFI decides and lends at its agency: Novi carries the request and her record.
export default function LoanScreen() {
  const { t } = useTranslation();
  const [page, setPage] = useState<LoanPage | null>(null);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState<LoanPurpose>("STOCK");
  const [months, setMonths] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getLoans().then(setPage, (err: unknown) => setError(errorKey(err)));
  }, []);
  useFocusEffect(load);

  async function run(action: () => Promise<LoanPage>) {
    setBusy(true);
    setError(null);
    try {
      setPage(await action());
      setAmount("");
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  if (!page) {
    return (
      <Screen>
        <BackHeader listenText={t("loan.title")} />
        <ErrorMessage messageKey={error} />
      </Screen>
    );
  }

  const mfi = page.mfiName ?? "FUCEC";
  const latest = page.requests[0];
  const value = Number(amount.replace(/\D/g, ""));
  const valid = value >= 5000 && value <= page.ceilingFcfa;

  function send() {
    Alert.alert(
      t("loan.confirmTitle"),
      t("loan.confirm", { amount: formatFcfa(value), mfi }),
      [
        { text: t("common.back"), style: "cancel" },
        {
          text: t("loan.send"),
          onPress: () => void run(() => requestLoan(value, purpose, months)),
        },
      ],
    );
  }

  return (
    <Screen>
      <BackHeader
        listenText={`${t("loan.title", { mfi })}. ${t("loan.intro", { mfi })}`}
      />
      <View style={styles.intro}>
        <Text style={[type.title, styles.indigo]}>
          {t("loan.title", { mfi })}
        </Text>
        <Text style={[type.body, styles.muted]}>
          {t("loan.intro", { mfi })}
        </Text>
      </View>

      {latest && latest.status !== "WITHDRAWN" ? (
        <View
          style={[
            styles.status,
            latest.status === "APPROVED" && styles.statusOk,
          ]}
        >
          <Text style={styles.statusTitle}>
            {latest.status === "APPROVED"
              ? t("loan.approved", {
                  amount: formatFcfa(latest.grantedFcfa ?? latest.amountFcfa),
                })
              : latest.status === "DECLINED"
                ? t("loan.declined")
                : t("loan.pending", { mfi })}
          </Text>
          <Text style={styles.statusSub}>
            {t("loan.requestLine", {
              amount: formatFcfa(latest.amountFcfa),
              purpose: t(`loan.purpose.${latest.purpose}`),
              months: latest.months,
              day: formatDay(latest.createdAt.slice(0, 10)),
            })}
          </Text>
          {latest.status === "APPROVED" ? (
            <Text style={styles.statusSub}>
              {t("loan.goToAgency", { mfi })}
            </Text>
          ) : null}
          {latest.decisionNote ? (
            <Text style={styles.statusSub}>« {latest.decisionNote} »</Text>
          ) : null}
          {latest.status === "PENDING" ? (
            <TextButton
              label={t("loan.withdraw")}
              disabled={busy}
              onPress={() => void run(() => withdrawLoan(latest.id))}
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.checks}>
        <Text style={styles.checksTitle}>{t("loan.conditions")}</Text>
        {page.checks.map((c) => (
          <Text
            key={c.key}
            style={[styles.check, c.ok ? styles.ok : styles.notYet]}
          >
            {c.ok ? "✓" : "–"}{" "}
            {t(`loan.check.${c.key}`, { percent: page.onTimePercent ?? 0 })}
          </Text>
        ))}
      </View>

      {page.eligible ? (
        <View style={styles.form}>
          <Field
            label={t("loan.amountLabel", { max: formatFcfa(page.ceilingFcfa) })}
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            maxLength={8}
            prefix="FCFA"
          />
          <Text style={styles.label}>{t("loan.purposeLabel")}</Text>
          <View style={styles.chips}>
            {PURPOSES.map((p) => (
              <Chip
                key={p}
                label={t(`loan.purpose.${p}`)}
                selected={purpose === p}
                onPress={() => setPurpose(p)}
              />
            ))}
          </View>
          <Text style={styles.label}>{t("loan.monthsLabel")}</Text>
          <View style={styles.chips}>
            {MONTHS.map((m) => (
              <Chip
                key={m}
                label={t("loan.months", { count: m })}
                selected={months === m}
                onPress={() => setMonths(m)}
              />
            ))}
          </View>
          <Text style={[type.small, styles.muted]}>
            {t("loan.shareNote", { mfi })}
          </Text>
          <PrimaryButton
            label={t("loan.send")}
            disabled={busy || !valid}
            onPress={send}
          />
        </View>
      ) : null}
      <ErrorMessage messageKey={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 8 },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
  status: {
    gap: 4,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
  },
  statusOk: { borderColor: colors.paid, backgroundColor: "#E3F1E9" },
  statusTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 18,
    lineHeight: 24,
    color: colors.indigo,
  },
  statusSub: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.ink,
  },
  checks: {
    gap: 6,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.mist,
  },
  checksTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.indigo,
    marginBottom: 2,
  },
  check: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  ok: { color: colors.paid },
  notYet: { color: colors.muted },
  form: { gap: 12 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
