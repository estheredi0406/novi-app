import type {
  ContributionView,
  MobileOperator,
  RoundDetail,
} from "@novi/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../../../../api/client";
import {
  checkContribution,
  getRound,
  payRound,
} from "../../../../../api/money";
import { Celebrate } from "../../../../../components/art/Celebrate";
import { BackHeader } from "../../../../../components/BackHeader";
import { ErrorMessage } from "../../../../../components/ErrorMessage";
import { CowrieMark } from "../../../../../components/BottomBar";
import { MemberFaces } from "../../../../../components/group/MemberFaces";
import { LaguneBand } from "../../../../../components/LaguneBand";
import { LineIcon } from "../../../../../components/LineIcon";
import { Screen } from "../../../../../components/Screen";
import { TextButton } from "../../../../../components/TextButton";
import { formatDay, formatFcfa } from "../../../../../lib/format";
import { openPaymentPage } from "../../../../../lib/openCall";
import { speak } from "../../../../../lib/speak";
import { useSession } from "../../../../../session/SessionProvider";
import { colors } from "../../../../../theme/colors";
import { fonts, type } from "../../../../../theme/typography";

// How often the app asks whether her payment went through while she confirms
// it on her phone, and for how long before it tells her to check later.
const POLL_MS = 3000;
const POLL_FOR_MS = 2 * 60 * 1000;

// One round (restyled D92, like the confirmation screens of Flooz and Mixx by
// Yas): what she pays, for which round, who receives; her service as two big
// choices; Payer with the cowrie; then who has paid, as faces in turn order
// (every member sees every payment, F8). Paying has three moments: she chooses her mobile money service and
// taps Pay; she confirms on her phone with her mobile money PIN, which Novi
// never sees; the receipt appears once the provider has confirmed.
export default function RoundScreen() {
  const { t } = useTranslation();
  const { member } = useSession();
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
    getRound(id, roundNumber).then(setRound, (err: unknown) =>
      setError(errorKey(err)),
    );
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
        // D86: inside Novi when the app has its web view, else the browser.
        void openPaymentPage(
          started.paymentUrl,
          started.id,
          formatFcfa(round ? round.amountFcfa : 0),
        );
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

  // What she pays: the full contribution. The pot is a little less, as 2% of
  // each payment goes to the group's caisse (D68).
  const amount = formatFcfa(round.amountFcfa);
  const canPay = round.myStatus === "UNPAID" || round.myStatus === "FAILED";
  const listen = `${t("money.roundTitle", { number: round.number, date: formatDay(round.dueDate) })}. ${t(
    "money.turnOf",
    {
      name: round.beneficiaryName,
    },
  )}.`;

  const pot = formatFcfa(round.potFcfa).replace(" FCFA", " F");
  const operators: { key: MobileOperator; label: string }[] = [
    { key: "MOOV_TG", label: t("money.moov") },
    { key: "TOGOCEL", label: t("money.togocel") },
  ];

  return (
    <Screen
      bleedTop
      top={
        <LaguneBand overlap={56}>
          <View style={styles.topRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common.back")}
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))}
              style={styles.round}
              hitSlop={6}
            >
              <Text style={styles.back}>‹</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("hub.listen")}
              onPress={() => speak(listen)}
              style={styles.round}
              hitSlop={6}
            >
              <LineIcon name="speaker" color={colors.white} size={22} />
            </Pressable>
          </View>
          <Text style={styles.bandTitle}>
            {canPay ? t("pay.bandTitle") : t("money.roundTitle", { number: round.number, date: formatDay(round.dueDate) })}
          </Text>
        </LaguneBand>
      }
    >
      <View style={[styles.summary, styles.lift]}>
        <Text style={styles.summaryLabel}>{canPay ? t("pay.youPay") : t("pay.contribution")}</Text>
        <Text style={styles.summaryAmount}>{amount}</Text>
        <View style={styles.facts}>
          <Fact label={t("pay.forRound")} value={t("pay.roundLine", { number: round.number, date: formatDay(round.dueDate) })} />
          <Fact label={t("pay.receives")} value={`${round.beneficiaryName} · ${pot}`} />
          <Fact label={t("pay.collected")} value={t("hub.paidCount", { paid: round.paidCount, size: round.size })} />
        </View>
      </View>

      {payment?.status === "PENDING" ? (
        <View style={styles.note}>
          <Text style={[type.title, styles.indigo]}>{t("money.confirmOnPhone")}</Text>
          <Text style={[type.body, styles.ink]}>
            {pageUrl ? t("money.confirmOnPageHint", { amount }) : t("money.confirmOnPhoneHint", { amount })}
          </Text>
          {pageUrl ? (
            <TextButton
              label={t("money.openPage")}
              onPress={() => payment && void openPaymentPage(pageUrl, payment.id, amount)}
            />
          ) : null}
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
          {payment?.status === "PAID" ? <Celebrate paid={round.paidCount} label={t("money.receiptTitle")} /> : null}
          <Text style={[type.title, styles.paid]}>{t("money.receiptTitle")}</Text>
          <Text style={[type.body, styles.ink]}>{t("money.receiptBody", { amount, number: round.number })}</Text>
          {payment?.receiptRef ? (
            <Text style={[type.small, styles.muted]}>{t("money.receiptRef", { ref: payment.receiptRef })}</Text>
          ) : null}
        </View>
      ) : null}

      {payment?.status === "FAILED" ? <ErrorMessage messageKey="money.paymentFailed" /> : null}

      {canPay && payment?.status !== "PENDING" && payment?.status !== "PAID" ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t("money.chooseOperator")}</Text>
          {operators.map((o) => {
            const on = operator === o.key;
            return (
              <Pressable
                key={o.key}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => setOperator(o.key)}
                style={[styles.operator, on && styles.operatorOn]}
              >
                <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
                <Text style={styles.operatorText}>{o.label}</Text>
              </Pressable>
            );
          })}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || operator === null }}
            disabled={busy || operator === null}
            onPress={() => operator && void pay(operator)}
            style={[styles.pay, (busy || operator === null) && styles.payOff]}
          >
            <CowrieMark size={30} />
            <Text style={styles.payText}>{t("money.pay", { amount })}</Text>
          </Pressable>
          <Text style={[type.small, styles.muted]}>{t("money.ownWallet")}</Text>
        </View>
      ) : null}

      <ErrorMessage messageKey={error} />

      <View style={styles.section}>
        <View style={styles.whoHead}>
          <Text style={styles.label}>{t("money.whoPaid")}</Text>
          <Text style={styles.small}>{t("hub.inTurnOrder")}</Text>
        </View>
        <View style={styles.card}>
          <MemberFaces payments={round.payments} memberId={member?.id ?? ""} receiverIndex={round.number - 1} />
        </View>
      </View>
    </Screen>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  indigo: { color: colors.indigo },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  paid: { color: colors.paid },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  round: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  back: { fontSize: 30, lineHeight: 34, marginTop: -3, color: colors.white },
  bandTitle: { fontFamily: fonts.bodyBold, fontSize: 24, lineHeight: 30, color: colors.white, marginTop: 8 },
  lift: { marginTop: -(56 + 20) },
  summary: {
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 22,
    gap: 6,
    elevation: 4,
    shadowColor: colors.indigo,
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  summaryLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  summaryAmount: { fontFamily: fonts.display, fontSize: 36, lineHeight: 44, color: colors.indigo },
  facts: { marginTop: 8, borderTopWidth: 1, borderTopColor: colors.line },
  fact: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  factLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  factValue: { flexShrink: 1, textAlign: "right", fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  section: { gap: 14 },
  label: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.indigo },
  small: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  whoHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  operator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  operatorOn: { borderColor: colors.lagoon, backgroundColor: colors.mist },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { borderColor: colors.lagoon },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.lagoon },
  operatorText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  pay: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  payOff: { opacity: 0.45 },
  payText: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.white },
  note: { gap: 8, padding: 16, borderRadius: 16, backgroundColor: colors.mist },
  receipt: {
    gap: 6,
    padding: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.paid,
    backgroundColor: colors.card,
  },
  card: { padding: 18, borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
});
