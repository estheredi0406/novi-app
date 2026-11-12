import type { PotChoiceView } from "@novi/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../api/client";
import { choosePot, getSavings } from "../../api/savings";
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

// D123, revised: three days before her pot, what she does with it, one
// question per screen (no long scroll on a small phone):
//   1. receive it all on her phone, place a part, or place it all;
//   2. how much to place (only for "a part");
//   3. for how long: 3, 6 or 12 months, each with what it earns;
//   4. the summary, and the first time her agreement to share her identity.
// Placed money stays at the MFI until its date, at the MFI's rate: there is
// no free savings pocket, so the MFI keeps one simple product.
type Mode = "WALLET" | "PART" | "ALL";
type Step = "what" | "amount" | "months" | "summary";
const LOCKS = [3, 6, 12] as const;
const F = (n: number) => formatFcfa(n).replace(" FCFA", " F");
// The same count as the server: simple interest, day by day, until the date.
const gain = (amount: number, bp: number | null, months: number) => {
  if (bp === null) return null;
  const end = new Date();
  end.setMonth(end.getMonth() + months);
  const days = (end.getTime() - Date.now()) / 86_400_000;
  return Math.floor((amount * bp * days) / (10_000 * 365));
};
const addMonths = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};

export default function SavingsChoiceScreen() {
  const { t, i18n } = useTranslation();
  const { round } = useLocalSearchParams<{ round: string }>();
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
        const c = s.choices.find((x) => x.roundId === round) ?? null;
        setChoice(c);
        if (!c) return;
        setMode(c.keepFcfa === 0 ? "WALLET" : c.keepFcfa >= c.potFcfa ? "ALL" : "PART");
        setPlace(c.keepFcfa > 0 && c.keepFcfa < c.potFcfa ? c.keepFcfa : Math.max(500, Math.round(c.potFcfa / 2 / 500) * 500));
        if (c.lockMonths === 3 || c.lockMonths === 6 || c.lockMonths === 12) setMonths(c.lockMonths);
      },
      (err: unknown) => setError(errorKey(err)),
    );
  }, [round]);

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
  const rateOf = (m: 3 | 6 | 12) => (m === 3 ? choice.rates.lock3Bp : m === 6 ? choice.rates.lock6Bp : choice.rates.lock12Bp);
  const needsConsent = kept > 0 && choice.accountStatus === null;
  // D125: a part is at least 500 F and leaves at least 500 F on her phone.
  const partMin = 500;
  const partMax = pot - 500;
  const partOk = Number.isInteger(place) && place >= partMin && place <= partMax;
  const keptOk = Number.isInteger(kept) && kept > 0 && kept <= pot;
  // The end date with its year: a 12-month placement ends next year.
  const until = new Date(`${addMonths(months)}T12:00:00Z`).toLocaleDateString(i18n.language === "en" ? "en-GB" : "fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  async function save(keep: number) {
    setBusy(true);
    setError(null);
    try {
      await choosePot(choice!.roundId, {
        keepFcfa: Math.round(keep),
        pocket: "LOCKED",
        lockMonths: keep > 0 ? months : null,
        consent,
      });
      router.back();
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
              {t("savings.potComes", { date: shortDay(choice.dueDate, i18n.language), group: choice.groupName })}
            </Text>
          </View>
          <Text style={styles.title}>{t("savings.choiceTitle", { pot: F(pot) })}</Text>
          <Choice on={mode === "WALLET"} title={t("savings.allWallet")} sub={t("savings.allWalletSub")} onPress={() => setMode("WALLET")} />
          <Choice
            on={mode === "PART"}
            title={t("savings.placePart")}
            sub={t("savings.placePartSub", { mfi: choice.mfiName })}
            onPress={() => setMode("PART")}
          />
          <Choice on={mode === "ALL"} title={t("savings.placeAll")} sub={t("savings.placeAllSub")} onPress={() => setMode("ALL")} />
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
            {gain(kept, rateOf(months), months) !== null ? (
              <Line
                label={t("savings.sumBack")}
                value={F(kept + (gain(kept, rateOf(months), months) ?? 0))}
                strong
              />
            ) : (
              <Text style={styles.small}>{t("savings.rateLater", { mfi: choice.mfiName })}</Text>
            )}
          </View>
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
});
