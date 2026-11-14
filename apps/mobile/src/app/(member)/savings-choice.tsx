import type { PotChoiceView, SavingsTerms } from "@novi/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../api/client";
import { choosePot, choosePotForGroup, getSavings } from "../../api/savings";
import { CheckRow } from "../../components/CheckRow";
import { CowrieMark } from "../../components/BottomBar";
import { ErrorMessage } from "../../components/ErrorMessage";
import { LineIcon } from "../../components/LineIcon";
import { ListenRound } from "../../components/ListenButton";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { Stepper } from "../../components/savings/Stepper";
import { formatFcfa, pct, shortDay } from "../../lib/format";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

// D123, D147: what she does with her pot, one question per screen: all to her
// phone or placed, how much, for how long, then a summary (and her consent the
// first time). The money stays at the MFI at the MFI's rate.
type Mode = "WALLET" | "PART" | "ALL";
type Step = "what" | "amount" | "months" | "summary";
const F = (n: number) => formatFcfa(n).replace(" FCFA", " F");
// The same count as the server: simple interest, day by day, until the date.
const gain = (amount: number, bp: number | null, months: number) => {
  if (bp === null) return null;
  const end = new Date();
  end.setMonth(end.getMonth() + months);
  const days = (end.getTime() - Date.now()) / 86_400_000;
  return Math.floor((amount * bp * days) / (10_000 * 365));
};
// D147: a placement starts when her pot arrives, not today.
const addMonths = (months: number, from: string | null) => {
  const d = from ? new Date(`${from}T12:00:00Z`) : new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};

export default function SavingsChoiceScreen() {
  const { t, i18n } = useTranslation();
  const { round, group } = useLocalSearchParams<{ round?: string; group?: string }>();
  const [choice, setChoice] = useState<PotChoiceView | null>(null);
  const [step, setStep] = useState<Step>("what");
  const [mode, setMode] = useState<Mode>("WALLET");
  const [place, setPlace] = useState(0);
  const [months, setMonths] = useState<3 | 6 | 12>(12);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSavings().then(
      (s) => {
        const c = s.choices.find((x) => (round ? x.roundId === round : x.groupId === group)) ?? null;
        setChoice(c);
        if (!c) return;
        setMode(c.keepFcfa === 0 ? "WALLET" : c.keepFcfa >= c.potFcfa ? "ALL" : "PART");
        const min = Math.max(500, c.terms.minKeepFcfa);
        setPlace(c.keepFcfa > 0 && c.keepFcfa < c.potFcfa ? c.keepFcfa : Math.max(min, Math.round(c.potFcfa / 2 / 500) * 500));
        const offered = c.terms.locks.map((l) => l.months);
        const saved = c.lockMonths;
        setMonths(saved === 3 || saved === 6 || saved === 12 ? (offered.includes(saved) ? saved : offered.at(-1) ?? 12) : (offered.at(-1) ?? 12));
      },
      (err: unknown) => setError(errorKey(err)),
    );
  }, [round, group]);

  const order: Step[] = mode === "PART" ? ["what", "amount", "months", "summary"] : ["what", "months", "summary"];
  const index = order.indexOf(step);
  const back = () => (index > 0 ? setStep(order[index - 1] as Step) : router.back());
  const next = () => setStep(order[index + 1] as Step);

  if (!choice) {
    return (
      <Screen>
        <Top onBack={() => router.back()} listen={t("savings.choiceTitle", { pot: "" })} />
        <ErrorMessage messageKey={error} />
      </Screen>
    );
  }

  const pot = choice.potFcfa;
  const kept = mode === "WALLET" ? 0 : mode === "ALL" ? pot : place;
  const terms = choice.terms;
  const LOCKS = terms.locks.map((l) => l.months);
  const rateOf = (m: 3 | 6 | 12) => terms.locks.find((l) => l.months === m)?.bp ?? null;
  const needsConsent = kept > 0 && choice.accountStatus === null;
  // D125: a part leaves at least 500 F on her phone; D147: and is at least the
  // caisse's minimum.
  const partMin = Math.max(500, terms.minKeepFcfa);
  const partMax = pot - 500;
  const partOk = Number.isInteger(place) && place >= partMin && place <= partMax;
  const keptOk = Number.isInteger(kept) && kept > 0 && kept <= pot;
  // The end date with its year: a 12-month placement ends next year. Before
  // the group starts her pot's day is not known yet: "12 mois après".
  const until = !choice.dueDate
    ? t("savings.afterPot", { count: months })
    : new Date(`${addMonths(months, choice.dueDate)}T12:00:00Z`).toLocaleDateString(i18n.language === "en" ? "en-GB" : "fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  async function save(keep: number) {
    setBusy(true);
    setError(null);
    try {
      const body = { keepFcfa: Math.round(keep), pocket: "LOCKED" as const, lockMonths: keep > 0 ? months : null, consent };
      await (choice!.roundId ? choosePot(choice!.roundId, body) : choosePotForGroup(choice!.groupId, body));
      if (router.canGoBack()) router.back();
      else router.replace("/home" as never);
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  const listen =
    step === "what"
      ? t("savings.choiceTitle", { pot: F(pot) })
      : step === "amount"
        ? t("savings.howMuch")
        : step === "months"
          ? t("savings.howLong")
          : t("savings.summaryTitle");

  return (
    <Screen>
      <Top onBack={back} listen={listen} />
      <View style={styles.body}>
      <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {order.map((s, i) => (
          <View key={s} style={[styles.dot, i <= index && styles.dotOn]} />
        ))}
      </View>

      {step === "what" ? (
        <>
          <View style={styles.kicker}>
            <CowrieMark size={24} fill={colors.yourTurn} />
            <Text style={styles.kickerText}>
              {choice.dueDate
                ? t("savings.potComes", { date: shortDay(choice.dueDate, i18n.language), group: choice.groupName })
                : t("savings.potOf", { group: choice.groupName })}
            </Text>
          </View>
          <Text style={styles.title}>{t("savings.choiceTitle", { pot: F(pot) })}</Text>
          <Choice on={mode === "WALLET"} title={t("savings.allWallet")} sub={t("savings.allWalletSub")} onPress={() => setMode("WALLET")} />
          {/* A part leaves 500 F on her phone and is at least the caisse's minimum. */}
          {pot >= partMin + 500 ? (
            <Choice
              on={mode === "PART"}
              title={t("savings.placePart")}
              sub={t("savings.placePartSub", { mfi: choice.mfiName })}
              onPress={() => setMode("PART")}
            />
          ) : null}
          {pot >= terms.minKeepFcfa ? (
            <Choice on={mode === "ALL"} title={t("savings.placeAll")} sub={t("savings.placeAllSub", { mfi: choice.mfiName })} onPress={() => setMode("ALL")} />
          ) : null}
          <Terms terms={terms} mfi={choice.mfiName} />
          <View style={styles.grow} />
          <ErrorMessage messageKey={error} />
          {mode === "WALLET" ? (
            <PrimaryButton label={t("savings.confirm")} disabled={busy} onPress={() => void save(0)} />
          ) : (
            <PrimaryButton label={t("savings.next")} onPress={next} />
          )}
        </>
      ) : null}

      {step === "amount" ? (
        <>
          <Text style={styles.title}>{t("savings.howMuch")}</Text>
          <Stepper
            value={place}
            min={partMin}
            max={partMax}
            step={pot >= 20_000 ? 1000 : 500}
            onChange={setPlace}
            caption={t("savings.placed")}
            lessLabel={t("savings.less")}
            moreLabel={t("savings.more")}
            inputLabel={t("savings.typeAmount")}
            rangeHint={t("savings.amountRange", { min: F(partMin), max: F(partMax) })}
          />
          {partOk ? (
            <View style={styles.split}>
              <LineIcon name="phone" color={colors.muted} size={20} />
              <Text style={styles.splitText}>{t("savings.onPhoneLine", { amount: F(pot - place) })}</Text>
            </View>
          ) : null}
          <View style={styles.grow} />
          <PrimaryButton label={t("savings.next")} disabled={!partOk} onPress={next} />
        </>
      ) : null}

      {step === "months" ? (
        <>
          <Text style={styles.title}>{t("savings.howLong")}</Text>
          <Text style={styles.lede}>{t("savings.howLongSub", { amount: F(kept) })}</Text>
          {LOCKS.map((m) => {
            const g = gain(kept, rateOf(m), m);
            return (
              <Pressable
                key={m}
                accessibilityRole="radio"
                accessibilityState={{ checked: months === m }}
                onPress={() => setMonths(m)}
                style={[styles.term, months === m && styles.termOn]}
              >
                <View style={styles.termLeft}>
                  <Text style={[styles.termMonths, months === m && styles.onDark]}>{t("savings.months", { count: m })}</Text>
                  <Text style={[styles.termRate, months === m && styles.onDarkSoft]}>
                    {pct(rateOf(m)) ? `${pct(rateOf(m))} ${t("savings.perYear")}` : t("savings.rateMfi")}
                  </Text>
                </View>
                {g !== null ? (
                  <View style={styles.termRight}>
                    <Text style={[styles.termGain, months === m && styles.onDark]}>+{F(g)}</Text>
                    <Text style={[styles.termRate, months === m && styles.onDarkSoft]}>{t("savings.earned")}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
          <View style={styles.grow} />
          <PrimaryButton label={t("savings.next")} disabled={!keptOk} onPress={next} />
        </>
      ) : null}

      {step === "summary" ? (
        <>
          <Text style={styles.title}>{t("savings.summaryTitle")}</Text>
          <View style={styles.summary}>
            {pot - kept > 0 ? <Line label={t("savings.sumPhone")} value={F(pot - kept)} /> : null}
            <Line label={t("savings.sumPlaced", { mfi: choice.mfiName })} value={F(kept)} />
            <Line label={t("savings.sumUntil")} value={until} />
            <Line label={t("savings.sumBack")} value={F(kept + (gain(kept, rateOf(months), months) ?? 0))} strong />
          </View>
          <Terms terms={terms} mfi={choice.mfiName} />
          {needsConsent ? (
            <View style={styles.consent}>
              <Text style={styles.small}>{t("savings.consentText", { mfi: choice.mfiName })}</Text>
              <CheckRow checked={consent} onToggle={() => setConsent(!consent)}>
                {t("savings.consent", { mfi: choice.mfiName })}
              </CheckRow>
            </View>
          ) : null}
          <Text style={styles.small}>{t("savings.safety")}</Text>
          <View style={styles.grow} />
          <ErrorMessage messageKey={error} />
          <PrimaryButton
            label={t("savings.confirmPlace", { amount: F(kept) })}
            disabled={busy || !keptOk || (mode === "PART" && !partOk) || (needsConsent && !consent)}
            onPress={() => void save(kept)}
          />
        </>
      ) : null}
      </View>
    </Screen>
  );
}

function Top({ onBack, listen }: { onBack: () => void; listen: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.top}>
      <Pressable accessibilityRole="button" accessibilityLabel={t("common.back")} onPress={onBack} style={styles.back} hitSlop={6}>
        <View style={styles.flip}>
          <LineIcon name="chevron" color={colors.action} size={20} />
        </View>
      </Pressable>
      <ListenRound text={listen} style={styles.listen} />
    </View>
  );
}

function Choice({ on, title, sub, onPress }: { on: boolean; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={[styles.choice, on && styles.choiceOn]}
    >
      <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
      <View style={styles.choiceText}>
        <Text style={styles.choiceTitle}>{title}</Text>
        <Text style={styles.choiceSub}>{sub}</Text>
      </View>
    </Pressable>
  );
}

// D147: the caisse's conditions in three short lines: rates, fees, and the
// minimum with what she loses taking it back early.
function Terms({ terms, mfi }: { terms: SavingsTerms; mfi: string }) {
  const { t } = useTranslation();
  const rates = t("savings.termsRates", {
    list: terms.locks.map((l) => t("savings.termsRate", { count: l.months, rate: pct(l.bp) ?? "0 %" })).join(" · "),
  });
  const fees = [
    terms.openingFeeFcfa > 0 ? t("savings.feeOpening", { amount: F(terms.openingFeeFcfa) }) : null,
    terms.monthlyFeeFcfa > 0 ? t("savings.feeMonthly", { amount: F(terms.monthlyFeeFcfa) }) : null,
    terms.withdrawalFeeFcfa > 0 ? t("savings.feeWithdrawal", { amount: F(terms.withdrawalFeeFcfa) }) : null,
  ].filter(Boolean);
  const early =
    terms.early.rule === "PENALTY"
      ? t("savings.earlyPenalty", { rate: pct(terms.early.penaltyBp) })
      : t("savings.earlyGains");
  return (
    <View style={styles.terms} accessibilityRole="summary">
      <Text style={styles.termsTitle}>{t("savings.termsTitle", { mfi })}</Text>
      <Text style={styles.termsLine}>{rates}</Text>
      <Text style={styles.termsLine}>{fees.length > 0 ? t("savings.fees", { list: fees.join(" · ") }) : t("savings.noFees")}</Text>
      <Text style={styles.termsLine}>
        {t("savings.minLine", { amount: F(terms.minKeepFcfa) })} · {early}
      </Text>
    </View>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.lineStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: -12 },
  body: { flexGrow: 1, gap: 14 },
  listen: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.mist, alignItems: "center", justifyContent: "center" },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.mist, alignItems: "center", justifyContent: "center" },
  flip: { transform: [{ rotate: "180deg" }] },
  dots: { flexDirection: "row", gap: 6 },
  dot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.line },
  dotOn: { backgroundColor: colors.action },
  kicker: { flexDirection: "row", alignItems: "center", gap: 8 },
  kickerText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 20, color: colors.turnText },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 32, color: colors.indigo },
  lede: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.muted, marginTop: -6 },
  grow: { flexGrow: 1, minHeight: 4 },
  choice: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  choiceOn: { borderWidth: 2, borderColor: colors.action, backgroundColor: colors.mist },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  radioOn: { borderColor: colors.action },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.action },
  choiceText: { flex: 1, gap: 2 },
  choiceTitle: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 22, color: colors.indigo },
  choiceSub: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.muted },
  split: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center" },
  splitText: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  term: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  termOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  termLeft: { gap: 2 },
  termRight: { alignItems: "flex-end", gap: 2 },
  termMonths: { fontFamily: fonts.bodyBold, fontSize: 18, lineHeight: 24, color: colors.indigo },
  termRate: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  termGain: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26, color: colors.paid },
  onDark: { color: colors.white },
  onDarkSoft: { color: colors.onDark },
  summary: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, gap: 2 },
  line: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  lineLabel: { flex: 1, fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.muted },
  lineValue: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 21, color: colors.ink, textAlign: "right" },
  lineStrong: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26, color: colors.paid },
  consent: { gap: 6, padding: 12, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  terms: { gap: 3, padding: 12, borderRadius: 14, backgroundColor: colors.mist },
  termsTitle: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 19, color: colors.indigo },
  termsLine: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.ink },
});
