import type { MySavings, SavingsAccountView } from "@novi/shared";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../api/client";
import { getSavings } from "../../api/savings";
import { BackHeader } from "../../components/BackHeader";
import { ErrorMessage } from "../../components/ErrorMessage";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { formatFcfa, pct, shortDay } from "../../lib/format";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

// D123: "Mon épargne". Her savings at the MFI: what she can
// withdraw now, what is locked and until when, the interest so far (an
// estimate; the MFI credits it by its own rules), and every movement.
const F = (n: number) => formatFcfa(n).replace(" FCFA", " F");

export default function SavingsScreen() {
  const { t } = useTranslation();
  const [data, setData] = useState<MySavings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getSavings().then(setData, (err: unknown) => setError(errorKey(err)));
    }, []),
  );

  return (
    <Screen>
      <BackHeader listenText={t("savings.title")} />
      <Text style={styles.title}>{t("savings.title")}</Text>
      {data && data.accounts.length === 0 ? <Text style={styles.muted}>{t("savings.none")}</Text> : null}
      {data?.accounts.map((a) => <Account key={a.id} a={a} />)}
      <ErrorMessage messageKey={error} />
    </Screen>
  );
}

function Account({ a }: { a: SavingsAccountView }) {
  const { t, i18n } = useTranslation();
  const day = (iso: string) => shortDay(iso.slice(0, 10), i18n.language);
  if (a.status !== "OPEN") {
    return (
      <View style={styles.box}>
        <Text style={styles.boxTitle}>{a.mfiName}</Text>
        <Text style={styles.muted}>
          {a.status === "REQUESTED" ? t("savings.opening", { mfi: a.mfiName }) : t("savings.refusedText", { reason: a.refusedReason ?? "" })}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <Text style={styles.heroSmall}>{t("savings.yours", { mfi: a.mfiName })}</Text>
        <Text style={styles.heroBig}>{F(a.totalFcfa)}</Text>
        <Text style={styles.heroSmall}>{t("savings.accountRef", { ref: a.ref })}</Text>
      </View>

      <View style={styles.box}>
        <Text style={styles.label}>{t("savings.interestMonth")}</Text>
        <Text style={[styles.value, styles.green]}>+{F(a.interestThisMonthFcfa)}</Text>
        <Text style={styles.small}>{t("savings.interestTotal", { amount: F(a.interestToDateFcfa) })}</Text>
      </View>

      {/* D123: each placement, what it earns if she waits, and a way out that says what she loses. */}
      {a.locked.map((l) => {
        const start = Date.parse(l.since);
        const end = Date.parse(l.unlockAt);
        const done = Math.min(1, Math.max(0, (Date.now() - start) / Math.max(1, end - start)));
        return (
          <View key={l.id} style={styles.box}>
            <View style={styles.placeHead}>
              <Text style={styles.boxTitle}>{t("savings.placementTitle", { amount: F(l.amountFcfa), count: l.lockMonths })}</Text>
              {pct(l.rateBp) ? <Text style={styles.small}>{`${pct(l.rateBp)} ${t("savings.perYear")}`}</Text> : null}
            </View>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${Math.round(done * 100)}%` }]} />
            </View>
            <Text style={styles.lineText}>
              {l.gainAtEndFcfa !== null
                ? t("savings.onDate", { date: day(l.unlockAt), amount: F(l.amountFcfa + l.gainAtEndFcfa) })
                : t("savings.onDateNoRate", { date: day(l.unlockAt), amount: F(l.amountFcfa) })}
            </Text>
            {l.gainAtEndFcfa ? <Text style={[styles.small, styles.green]}>{t("savings.gainLine", { amount: F(l.gainAtEndFcfa) })}</Text> : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/savings-early" as never, params: { account: a.id, entry: l.id } })}
              hitSlop={8}
              style={styles.early}
            >
              <Text style={styles.earlyText}>{t("savings.takeBackEarly")}</Text>
            </Pressable>
          </View>
        );
      })}

      {a.freeFcfa >= 500 ? (
        <PrimaryButton
          label={t("savings.withdrawAvailable", { amount: F(a.freeFcfa) })}
          onPress={() => router.push({ pathname: "/savings-withdraw" as never, params: { account: a.id } })}
        />
      ) : null}

      <View style={styles.box}>
        <Text style={styles.boxTitle}>{t("savings.movements")}</Text>
        {a.entries.map((e) => (
          <View key={e.id} style={styles.move}>
            <View style={styles.moveText}>
              <Text style={styles.lineText}>
                {e.kind === "POT_KEPT"
                  ? e.pocket === "LOCKED"
                    ? t("savings.keptLocked", { count: e.lockMonths ?? 0 })
                    : t("savings.keptFree")
                  : e.status === "SENDING"
                    ? t("savings.withdrawing")
                    : e.early
                      ? t("savings.withdrawnEarly")
                      : t("savings.withdrawn")}
              </Text>
              <Text style={styles.small}>{day(e.at)}</Text>
            </View>
            <Text style={[styles.amount, e.amountFcfa > 0 && styles.green]}>
              {e.amountFcfa > 0 ? `+${F(e.amountFcfa)}` : `−${F(-e.amountFcfa)}`}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 40, color: colors.indigo },
  muted: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.muted },
  wrap: { gap: 14 },
  hero: { backgroundColor: colors.indigo, borderRadius: 22, padding: 20, gap: 4 },
  heroSmall: { fontFamily: fonts.body, fontSize: 14, color: colors.onDark },
  heroBig: { fontFamily: fonts.display, fontSize: 34, lineHeight: 44, color: colors.white },
  row2: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  box: { gap: 6, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  boxTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.indigo },
  label: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  value: { fontFamily: fonts.display, fontSize: 22, lineHeight: 30, color: colors.indigo },
  green: { color: colors.paid },
  small: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.muted },
  line: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.line },
  lineText: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 21, color: colors.ink },
  move: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line },
  moveText: { flex: 1 },
  amount: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  placeHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.seatEmpty, overflow: "hidden", marginVertical: 4 },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.paid },
  early: { alignSelf: "flex-start", minHeight: 36, justifyContent: "center" },
  earlyText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.action },
});
