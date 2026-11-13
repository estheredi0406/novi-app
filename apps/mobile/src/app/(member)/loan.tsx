import type {
  BusinessKind,
  BusinessSince,
  LoanCheck,
  LoanPage,
  LoanPurpose,
  LoanRequestView,
} from "@novi/shared";
import { useFocusEffect } from "expo-router";
import type { TFunction } from "i18next";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Alert } from "../../lib/alert";
import { errorKey } from "../../api/client";
import { getLoans, requestLoan, withdrawLoan } from "../../api/help";
import { BackHeader } from "../../components/BackHeader";
import { Chip } from "../../components/Chip";
import { ErrorMessage } from "../../components/ErrorMessage";
import { LineIcon } from "../../components/LineIcon";
import { RecordShare } from "../../components/RecordShare";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { TextButton } from "../../components/TextButton";
import { formatDay, formatFcfa } from "../../lib/format";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

const PURPOSES: LoanPurpose[] = ["STOCK", "EQUIPMENT", "OTHER"];
const KINDS: BusinessKind[] = ["FABRICS", "FOOD", "RESTAURANT", "BEAUTY", "OTHER"];
const SINCE: BusinessSince[] = ["UNDER_1Y", "Y1_TO_3", "OVER_3Y"];

// One of the MFI's conditions, in words, with her own figure (D91).
function checkText(t: TFunction, c: LoanCheck): [string, string] {
  const f = c.figures;
  switch (c.key) {
    case "CYCLE_OR_STREAK":
      return [
        t("loan.cond.cycle", { cycles: f.minCycles, streak: f.minStreak }),
        t("loan.cond.cycleHave", { cycles: f.cycles, streak: f.streak }),
      ];
    case "ON_TIME":
      return [
        t("loan.cond.onTime", { min: f.min }),
        t("loan.cond.onTimeHave", {
          percent: f.percent,
          on: f.onTime,
          made: f.made,
        }),
      ];
    case "NO_DEBT":
      return [
        t("loan.cond.noDebt"),
        f.owes
          ? t("loan.cond.owes", { amount: formatFcfa(f.owes) })
          : t("loan.cond.owesNothing"),
      ];
    case "WAIT_AFTER_REFUSAL":
      return [
        t("loan.cond.wait", { days: f.wait }),
        f.days ? t("loan.cond.refusedAgo", { days: f.days }) : "",
      ];
    case "SAVINGS": // D123
      return [t("loan.cond.savings"), ""];
    default:
      return [t("loan.cond.open"), ""];
  }
}

// "Crédit" (D89, D91). Not yet: what is missing and what is already fine.
// She can ask: the amount, what for, and her business, which she declares.
// Her request then follows four steps: sent, kept by the MFI, signing at the
// agency with the documents listed, money paid. Novi keeps no document.
export default function LoanScreen() {
  const { t } = useTranslation();
  const [page, setPage] = useState<LoanPage | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [purpose, setPurpose] = useState<LoanPurpose>("STOCK");
  const [kind, setKind] = useState<BusinessKind | null>(null);
  const [since, setSince] = useState<BusinessSince | null>(null);
  const [sales, setSales] = useState<string | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [editPlace, setEditPlace] = useState(false);
  const [showChecks, setShowChecks] = useState(false);
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
      setAmount(null);
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  if (!page) {
    return (
      <Screen>
        <BackHeader listenText={t("loan.menu")} />
        <ErrorMessage messageKey={error} />
      </Screen>
    );
  }

  const mfi = page.mfiName ?? t("loan.yourMfi");
  const latest = page.requests.find((r) => r.status !== "WITHDRAWN");
  const latestOpen = latest?.status === "PENDING" || latest?.status === "PRESELECTED";
  const stepF = page.ceilingFcfa > 100_000 ? 10_000 : 5_000;
  const top = Math.max(5_000, Math.floor(page.ceilingFcfa / 5_000) * 5_000);
  const value = amount ?? Math.min(top, Math.max(5_000, Math.round(page.ceilingFcfa / 2 / 5_000) * 5_000));
  const okChecks = page.checks.filter((c) => c.ok);
  const missing = page.checks.filter((c) => !c.ok);

  // Her last answers are the starting point; the place comes from sign-up.
  const b = page.business;
  const kindNow = kind ?? b?.kind ?? null;
  const sinceNow = since ?? b?.since ?? null;
  const salesText = sales ?? (b ? String(b.weeklySalesFcfa) : "");
  const salesFcfa = Number(salesText.replace(/\D/g, ""));
  const placeNow = (place ?? b?.place ?? page.place).trim();
  const valid =
    value >= 5000 && value <= page.ceilingFcfa && kindNow !== null && sinceNow !== null && salesFcfa >= 100 && placeNow.length >= 2;

  function send() {
    if (!kindNow || !sinceNow) return;
    const business = { kind: kindNow, since: sinceNow, weeklySalesFcfa: salesFcfa, place: placeNow };
    Alert.alert(t("loan.confirmTitle"), t("loan.confirm", { amount: formatFcfa(value), mfi }), [
      { text: t("common.back"), style: "cancel" },
      { text: t("loan.send"), onPress: () => void run(() => requestLoan(value, purpose, business)) },
    ]);
  }

  return (
    <Screen>
      <BackHeader listenText={t("loan.title", { mfi })} />
      <Text style={[type.title, styles.indigo]}>{t("loan.title", { mfi })}</Text>

      {latest ? <Follow loan={latest} mfi={mfi} /> : null}
      {latestOpen && latest ? (
        <TextButton label={t("loan.withdraw")} disabled={busy} onPress={() => void run(() => withdrawLoan(latest.id))} />
      ) : null}

      {!page.enabled ? <Text style={[type.body, styles.muted]}>{t("loan.closed", { mfi })}</Text> : null}

      {page.enabled && page.eligible && !latestOpen ? (
        <>
          <View style={styles.card}>
            <Text style={[type.small, styles.muted]}>{t("loan.canAskLabel")}</Text>
            <Text style={styles.big}>{formatFcfa(page.ceilingFcfa).replace(" FCFA", " F")}</Text>
            <Text style={[type.small, styles.muted]}>{t("loan.canAskLine")}</Text>
            <Pressable accessibilityRole="button" onPress={() => setShowChecks(!showChecks)} style={styles.link}>
              <Text style={styles.linkText}>{showChecks ? t("loan.hideConditions") : t("loan.seeConditions")}</Text>
            </Pressable>
          </View>
          {showChecks ? <Checks checks={page.checks} mfi={mfi} /> : null}

          <Text style={styles.q}>{t("loan.howMuch")}</Text>
          <View style={styles.stepper}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("loan.less", { amount: formatFcfa(stepF) })}
              disabled={value - stepF < 5_000}
              onPress={() => setAmount(Math.max(5_000, value - stepF))}
              style={[styles.round, value - stepF < 5_000 && styles.roundOff]}
            >
              <Text style={styles.roundText}>−</Text>
            </Pressable>
            <Text style={styles.stepAmount} numberOfLines={1} adjustsFontSizeToFit>
              {formatFcfa(value).replace(" FCFA", " F")}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("loan.more", { amount: formatFcfa(stepF) })}
              disabled={value + stepF > page.ceilingFcfa}
              onPress={() => setAmount(Math.min(top, value + stepF))}
              style={[styles.round, value + stepF > page.ceilingFcfa && styles.roundOff]}
            >
              <Text style={styles.roundText}>+</Text>
            </Pressable>
          </View>

          <Text style={styles.q}>{t("loan.purposeLabel")}</Text>
          <View style={styles.purposes}>
            {PURPOSES.map((p) => (
              <Pressable
                key={p}
                accessibilityRole="radio"
                accessibilityState={{ checked: purpose === p }}
                onPress={() => setPurpose(p)}
                style={[styles.purpose, purpose === p && styles.purposeOn]}
              >
                <Text style={[styles.purposeText, purpose === p && styles.purposeTextOn]}>{t(`loan.purpose.${p}`)}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.q}>{t("loan.business")}</Text>
            <Text style={styles.label}>{t("loan.kindLabel")}</Text>
            <View style={styles.chips}>
              {KINDS.map((k) => (
                <Chip key={k} label={t(`loan.kind.${k}`)} selected={kindNow === k} onPress={() => setKind(k)} />
              ))}
            </View>
            <Text style={styles.label}>{t("loan.sinceLabel")}</Text>
            <View style={styles.chips}>
              {SINCE.map((k) => (
                <Chip key={k} label={t(`loan.since.${k}`)} selected={sinceNow === k} onPress={() => setSince(k)} />
              ))}
            </View>
            <Text style={styles.label}>{t("loan.salesLabel")}</Text>
            <View style={styles.field}>
              <TextInput
                accessibilityLabel={t("loan.salesLabel")}
                value={salesText ? formatFcfa(salesFcfa).replace(" FCFA", "") : ""}
                onChangeText={(v) => setSales(v.replace(/\D/g, "").slice(0, 9))}
                keyboardType="number-pad"
                style={styles.input}
              />
              <Text style={[type.small, styles.muted]}>F</Text>
            </View>
            <View style={styles.place}>
              <LineIcon name="pin" size={20} color={colors.muted} />
              {editPlace ? (
                <TextInput
                  accessibilityLabel={t("loan.placeLabel")}
                  value={place ?? placeNow}
                  onChangeText={setPlace}
                  maxLength={80}
                  autoFocus
                  style={[styles.input, styles.flex]}
                />
              ) : (
                <Text style={[type.body, styles.ink, styles.flex]}>{placeNow || t("loan.placeLabel")}</Text>
              )}
              <TextButton
                label={editPlace ? t("loan.placeDone") : t("loan.placeEdit")}
                onPress={() => setEditPlace(!editPlace)}
              />
            </View>
          </View>

          <Text style={[type.small, styles.muted, styles.center]}>{t("loan.shareNote", { mfi })}</Text>
          <PrimaryButton label={t("loan.sendTo", { mfi })} disabled={busy || !valid} onPress={send} />
        </>
      ) : null}

      {page.enabled && !page.eligible && !latestOpen ? (
        <>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>
              {t(page.onTimeNeeded ? "loan.almost" : "loan.notYet")}
            </Text>
            <Text style={styles.heroTitle}>
              {page.onTimeNeeded
                ? t("loan.almostTitle", { count: page.onTimeNeeded })
                : t("loan.missingTitle", { count: missing.length })}
            </Text>
            {page.onTimeNeeded ? (
              <Text style={styles.heroText}>
                {t("loan.almostText", {
                  count: page.onTimeNeeded,
                  amount: formatFcfa(page.ceilingFcfa),
                })}
              </Text>
            ) : null}
          </View>
          <Checks checks={missing} mfi={mfi} title={t("loan.stillMissing")} />
          {okChecks.length > 0 ? (
            <Checks
              checks={okChecks}
              mfi={mfi}
              title={t("loan.alreadyGood")}
              count={`${okChecks.length} / ${page.checks.length}`}
            />
          ) : null}
          <View style={styles.ceiling}>
            <Text style={styles.ceilingAmount}>
              {formatFcfa(page.ceilingFcfa).replace(" FCFA", " F")}
            </Text>
            <Text style={styles.ceilingText}>
              {t("loan.ceilingNote", { mfi })}
            </Text>
          </View>
        </>
      ) : null}
      <ErrorMessage messageKey={error} />
      <RecordShare />
    </Screen>
  );
}

// Where her request stands: a bar of four steps, one sentence, and what to
// bring once the MFI has kept it.
function Follow({ loan, mfi }: { loan: LoanRequestView; mfi: string }) {
  const { t } = useTranslation();
  const amount = formatFcfa(loan.grantedFcfa ?? loan.amountFcfa);
  const s = loan.status;
  const step = s === "PENDING" ? 2 : s === "PRESELECTED" ? 3 : 4;
  const failed = s === "DECLINED" || s === "NOT_GRANTED";
  const [title, sub] =
    s === "PENDING"
      ? [t("loan.statusPending"), t("loan.statusPendingSub")]
      : s === "PRESELECTED"
        ? [t("loan.statusToSign"), t("loan.statusToSignSub", { mfi, amount })]
        : s === "GRANTED"
          ? [t("loan.granted", { amount }), t("loan.grantedSub")]
          : [t(s === "DECLINED" ? "loan.declined" : "loan.notGranted"), loan.decisionNote ? `« ${loan.decisionNote} »` : ""];
  const shown = s === "DECLINED" ? 2 : step;
  return (
    <>
      <View style={styles.card}>
        <View style={styles.bar} accessibilityLabel={t("loan.stepOf", { n: shown })}>
          {[1, 2, 3, 4].map((n) => (
            <View
              key={n}
              style={[
                styles.seg,
                n < shown && styles.segDone,
                n === shown && (failed ? styles.segFailed : s === "GRANTED" ? styles.segDone : styles.segNow),
              ]}
            />
          ))}
        </View>
        <Text style={[type.small, styles.muted]}>
          {t("loan.requestLine", {
            amount: formatFcfa(loan.amountFcfa),
            purpose: t(`loan.purpose.${loan.purpose}`),
            day: formatDay(loan.createdAt.slice(0, 10)),
          })}
        </Text>
        <Text style={[styles.status, failed && styles.problem]}>{title}</Text>
        {sub ? <Text style={[type.small, styles.muted]}>{sub}</Text> : null}
      </View>
      {s === "PRESELECTED" && loan.toBring.length > 0 ? (
        <>
          <View style={styles.card}>
            <Text style={styles.q}>{t("loan.toBring")}</Text>
            {loan.toBring.map((d) => (
              <View key={d} style={styles.bringRow}>
                <LineIcon name="check" size={16} color={colors.action} />
                <Text style={[type.body, styles.ink, styles.flex]}>{d}</Text>
              </View>
            ))}
          </View>
          <Text style={[type.small, styles.muted, styles.center]}>{t("loan.paidAfterSign")}</Text>
        </>
      ) : null}
    </>
  );
}

// A list of the MFI's conditions, each with her own figure (D91).
function Checks({
  checks,
  mfi,
  title,
  count,
}: {
  checks: LoanCheck[];
  mfi: string;
  title?: string;
  count?: string;
}) {
  const { t } = useTranslation();
  if (checks.length === 0) return null;
  return (
    <View style={styles.checks}>
      <View style={styles.checksHead}>
        <Text style={styles.boxTitle}>
          {title ?? t("loan.conditions", { mfi })}
        </Text>
        {count ? (
          <Text style={[styles.boxTitle, styles.ok]}>{count}</Text>
        ) : null}
      </View>
      {checks.map((c) => {
        const [text, have] = checkText(t, c);
        return (
          <View key={c.key} style={styles.check}>
            <View style={[styles.mark, c.ok ? styles.markOk : styles.markNo]}>
              {c.ok ? (
                <LineIcon name="check" size={13} color={colors.white} />
              ) : (
                <Text style={styles.markNoText}>–</Text>
              )}
            </View>
            <View style={styles.checkText}>
              <Text style={styles.checkLine}>{text}</Text>
              {have ? (
                <Text style={[styles.have, c.ok && styles.ok]}>
                  {t("loan.you", { what: have })}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
  ink: { color: colors.ink },
  ok: { color: colors.paid },
  problem: { color: colors.problem },
  flex: { flex: 1 },
  center: { textAlign: "center" },
  card: { gap: 10, padding: 16, borderRadius: 16, backgroundColor: colors.card },
  big: { fontFamily: fonts.display, fontSize: 30, lineHeight: 38, color: colors.indigo },
  link: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  linkText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.action, textDecorationLine: "underline" },
  q: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.indigo },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink, marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  input: { flex: 1, minWidth: 0, fontFamily: fonts.bodySemiBold, fontSize: 17, color: colors.indigo, paddingVertical: 8 },
  place: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: 10,
    borderRadius: 16,
    backgroundColor: colors.card,
  },
  round: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.mist, alignItems: "center", justifyContent: "center" },
  roundOff: { opacity: 0.4 },
  roundText: { fontFamily: fonts.bodyBold, fontSize: 26, lineHeight: 30, color: colors.action },
  stepAmount: { flex: 1, textAlign: "center", fontFamily: fonts.display, fontSize: 28, lineHeight: 36, color: colors.indigo },
  purposes: { flexDirection: "row", gap: 8 },
  purpose: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  purposeOn: { borderWidth: 2, borderColor: colors.action },
  purposeText: { textAlign: "center", fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  purposeTextOn: { fontFamily: fonts.bodySemiBold, color: colors.action },
  bar: { flexDirection: "row", gap: 6 },
  seg: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.seatEmpty },
  segDone: { backgroundColor: colors.paid },
  segNow: { backgroundColor: colors.action },
  segFailed: { backgroundColor: colors.problem },
  status: { fontFamily: fonts.bodyBold, fontSize: 22, lineHeight: 28, color: colors.indigo },
  bringRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 40 },
  checks: { gap: 4, padding: 16, borderRadius: 16, backgroundColor: colors.mist },
  checksHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  boxTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.indigo },
  check: { flexDirection: "row", gap: 10, paddingVertical: 6 },
  mark: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  markOk: { backgroundColor: colors.paid },
  markNo: { backgroundColor: colors.card },
  markNoText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.indigo },
  checkText: { flex: 1, gap: 2 },
  checkLine: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink },
  have: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.muted },
  hero: { backgroundColor: colors.indigo, borderRadius: 22, padding: 18, gap: 6 },
  heroKicker: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.yourTurn },
  heroTitle: { fontFamily: fonts.display, fontSize: 22, lineHeight: 30, color: colors.white },
  heroText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.onDark },
  ceiling: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.turnSoft },
  ceilingAmount: { fontFamily: fonts.display, fontSize: 22, lineHeight: 30, color: colors.turnText },
  ceilingText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.turnText },
});
