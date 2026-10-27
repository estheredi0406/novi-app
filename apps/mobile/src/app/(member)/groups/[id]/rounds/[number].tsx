import type { ContributionView, MobileOperator, RoundDetail } from "@novi/shared";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../../../../api/client";
import { checkContribution, getRound, payRound } from "../../../../../api/money";
import { Celebrate } from "../../../../../components/art/Celebrate";
import { BackHeader } from "../../../../../components/BackHeader";
import { Chip } from "../../../../../components/Chip";
import { ErrorMessage } from "../../../../../components/ErrorMessage";
import { PrimaryButton } from "../../../../../components/PrimaryButton";
import { RoundCard } from "../../../../../components/RoundCard";
import { Screen } from "../../../../../components/Screen";
import { TextButton } from "../../../../../components/TextButton";
import { formatDay, formatFcfa } from "../../../../../lib/format";
import { colors } from "../../../../../theme/colors";
import { fonts, type } from "../../../../../theme/typography";

// How often the app asks whether her payment went through while she confirms
// it on her phone, and for how long before it tells her to check later.
const POLL_MS = 3000;
const POLL_FOR_MS = 2 * 60 * 1000;

// One round: who has paid (every member sees every payment, F8), and her own
// payment. Paying has three moments: she chooses her mobile money service and
// taps Pay; she confirms on her phone with her mobile money PIN, which Novi
// never sees; the receipt appears once the provider has confirmed.
export default function RoundScreen() {
  const { t } = useTranslation();
  const { id, number } = useLocalSearchParams<{ id: string; number: string }>();
  const roundNumber = Number(number);
  const [round, setRound] = useState<RoundDetail | null>(null);
  const [operator, setOperator] = useState<MobileOperator | null>(null);
  const [payment, setPayment] = useState<ContributionView | null>(null);
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollStarted = useRef(0);

  const load = useCallback(() => {
    getRound(id, roundNumber).then(setRound, (err: unknown) => setError(errorKey(err)));
  }, [id, roundNumber]);

  useEffect(load, [load]);

  // While her payment is pending, asks every few seconds whether it went through.
  useEffect(() => {
    if (payment?.status !== "PENDING") return;
    if (Date.now() - pollStarted.current > POLL_FOR_MS) {
      setWaitedTooLong(true);
      return;
    }
    const timer = setTimeout(() => {
      checkContribution(payment.id).then(
        (next) => {
          setPayment(next);
          if (next.status !== "PENDING") load();
        },
        () => setPayment({ ...payment }), // a failed check simply tries again
      );
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [payment, load]);

  const [pageUrl, setPageUrl] = useState<string | null>(null);

  async function pay(chosen: MobileOperator) {
    setBusy(true);
    setError(null);
    setWaitedTooLong(false);
    try {
      pollStarted.current = Date.now();
      const started = await payRound(id, roundNumber, chosen);
      setPayment(started);
      // Checkout (D64): she approves on the provider's page, then comes back;
      // Novi keeps checking until the payment is confirmed.
      if (started.paymentUrl) {
        setPageUrl(started.paymentUrl);
        void Linking.openURL(started.paymentUrl);
      }
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  if (!round) {
    return (
      <Screen>
        <BackHeader listenText={t("group.loading")} />
        <ErrorMessage messageKey={error} />
      </Screen>
    );
  }

  const amount = formatFcfa(round.potFcfa / round.size);
  const canPay = round.myStatus === "UNPAID" || round.myStatus === "FAILED";
  const listen = `${t("money.roundTitle", { number: round.number, date: formatDay(round.dueDate) })}. ${t("money.turnOf", {
    name: round.beneficiaryName,
  })}.`;

  return (
    <Screen>
      <BackHeader listenText={listen} />
      <RoundCard round={round} onPress={load} />

      {payment?.status === "PENDING" ? (
        <View style={styles.note}>
          <Text style={[type.title, styles.indigo]}>{t("money.confirmOnPhone")}</Text>
          <Text style={[type.body, styles.ink]}>
            {pageUrl ? t("money.confirmOnPageHint", { amount }) : t("money.confirmOnPhoneHint", { amount })}
          </Text>
          {pageUrl ? <TextButton label={t("money.openPage")} onPress={() => void Linking.openURL(pageUrl)} /> : null}
          {waitedTooLong ? (
            <>
              <Text style={[type.small, styles.muted]}>{t("money.stillWaiting")}</Text>
              <TextButton
                label={t("money.checkAgain")}
                onPress={() => {
                  pollStarted.current = Date.now();
                  setWaitedTooLong(false);
                  setPayment({ ...payment });
                }}
              />
            </>
          ) : null}
        </View>
      ) : null}

      {payment?.status === "PAID" || (round.myStatus === "PAID" && payment === null) ? (
        <View style={styles.receipt} accessibilityLiveRegion="polite">
          {payment?.status === "PAID" ? (
            <Celebrate paid={round.paidCount} label={t("money.receiptTitle")} />
          ) : null}
          <Text style={[type.title, styles.paid]}>{t("money.receiptTitle")}</Text>
          <Text style={[type.body, styles.ink]}>{t("money.receiptBody", { amount, number: round.number })}</Text>
          {payment?.receiptRef ? <Text style={[type.small, styles.muted]}>{t("money.receiptRef", { ref: payment.receiptRef })}</Text> : null}
        </View>
      ) : null}

      {payment?.status === "FAILED" ? <ErrorMessage messageKey="money.paymentFailed" /> : null}

      {canPay && payment?.status !== "PENDING" && payment?.status !== "PAID" ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t("money.chooseOperator")}</Text>
          <View style={styles.chips}>
            <Chip label={t("money.moov")} selected={operator === "MOOV_TG"} onPress={() => setOperator("MOOV_TG")} />
            <Chip label={t("money.togocel")} selected={operator === "TOGOCEL"} onPress={() => setOperator("TOGOCEL")} />
          </View>
          <PrimaryButton
            label={t("money.pay", { amount })}
            disabled={busy || operator === null}
            onPress={() => operator && void pay(operator)}
          />
          <Text style={[type.small, styles.muted]}>{t("money.ownWallet")}</Text>
        </View>
      ) : null}

      <ErrorMessage messageKey={error} />

      <View style={styles.section}>
        <Text style={[type.title, styles.ink]}>{t("money.whoPaid")}</Text>
        {round.payments.map((member) => (
          <View key={member.memberId} style={styles.row}>
            <Text style={[type.body, styles.name]}>{member.displayName}</Text>
            <Text style={member.status === "PAID" ? styles.paidLabel : styles.waitLabel}>
              {member.status === "PAID" && member.paidAt
                ? t("money.paidOn", { date: formatDay(member.paidAt) })
                : t(`money.status.${member.status}`)}
            </Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  indigo: { color: colors.indigo },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  paid: { color: colors.paid },
  section: { gap: 12 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  note: { gap: 8, padding: 16, borderRadius: 14, backgroundColor: colors.mist },
  receipt: { gap: 6, padding: 16, borderRadius: 14, borderWidth: 2, borderColor: colors.paid, backgroundColor: colors.card },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  name: { fontFamily: fonts.bodySemiBold, color: colors.ink },
  paidLabel: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.paid },
  waitLabel: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.muted },
});
