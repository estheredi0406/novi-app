import type { SavingsRecord, Statement, StatementLine } from "@novi/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getStatement } from "../../api/news";
import { formatFcfa } from "../../lib/format";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";
import { SeatRing } from "../art/SeatRing";

// Her statement on "Mon relevé" (D92, board E6): her on-time share on a ring
// at the top (the same facts FUCEC sees if she shares her record), then every
// payment and pot, month by month, like a bank statement. Each payment says
// whether it was on time.
type Filter = "ALL" | "PAID" | "RECEIVED";

export function StatementView({ record }: { record: SavingsRecord }) {
  const { t, i18n } = useTranslation();
  const [statement, setStatement] = useState<Statement | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");

  useEffect(() => {
    getStatement()
      .then(setStatement)
      .catch(() => setStatement({ lines: [] }));
  }, []);

  const made = record.paymentsMade;
  const onTime = record.paidOnTime;
  const rate = made > 0 ? Math.round((onTime / made) * 100) : null;
  // The ring shows at most 12 payments: the latest ones, late ones in red.
  const recent = (statement?.lines ?? []).filter((l) => l.kind === "PAID").slice(0, 12).reverse();

  const locale = i18n.language === "en" ? "en-GB" : "fr-FR";
  const lines = (statement?.lines ?? []).filter((l) => filter === "ALL" || l.kind === filter);
  const months = new Map<string, StatementLine[]>();
  for (const l of lines) {
    const key = l.at.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), l]);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.summary}>
        {recent.length > 0 ? (
          <SeatRing paid={recent.map((l) => l.onTime === true)} size={96}>
            <Text style={styles.rate}>{rate === null ? "…" : `${rate} %`}</Text>
          </SeatRing>
        ) : null}
        <View style={styles.summaryText}>
          <Text style={styles.big}>{t("record.onTimeOf", { onTime, made })}</Text>
          <Text style={styles.light}>{t("record.onTimeLabel")}</Text>
          <Text style={styles.light}>
            {t("record.potsLine", { count: record.potsReceived })}
            {record.missed === 0 ? ` · ${t("record.noDebt")}` : ""}
          </Text>
        </View>
      </View>

      <View style={styles.filters}>
        {(["ALL", "PAID", "RECEIVED"] as const).map((f) => (
          <Pressable
            key={f}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f }}
            onPress={() => setFilter(f)}
            style={[styles.filter, filter === f && styles.filterOn]}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextOn]}>
              {t(`statement.${f === "ALL" ? "all" : f === "PAID" ? "paid" : "received"}`)}
            </Text>
          </Pressable>
        ))}
      </View>

      {statement && lines.length === 0 ? <Text style={styles.empty}>{t("statement.empty")}</Text> : null}

      {[...months.entries()].map(([month, items]) => {
        const paid = items.filter((l) => l.kind === "PAID").reduce((s, l) => s + l.amountFcfa, 0);
        const title = new Date(`${month}-15T12:00:00Z`).toLocaleDateString(locale, {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        });
        return (
          <View key={month} style={styles.month}>
            <View style={styles.monthHead}>
              <Text style={styles.monthTitle}>{title.charAt(0).toUpperCase() + title.slice(1)}</Text>
              {paid > 0 ? (
                <Text style={styles.monthSum}>{t("statement.monthPaid", { amount: formatFcfa(paid).replace(" FCFA", " F") })}</Text>
              ) : null}
            </View>
            <View style={styles.box}>
              {items.map((l, i) => (
                <Line key={l.id} line={l} first={i === 0} locale={locale} />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Line({ line, first, locale }: { line: StatementLine; first: boolean; locale: string }) {
  const { t } = useTranslation();
  const date = new Date(line.at);
  const received = line.kind === "RECEIVED";
  const amount = `${received ? "+ " : "− "}${formatFcfa(line.amountFcfa).replace(" FCFA", " F")}`;
  return (
    <View style={[styles.line, !first && styles.divider]}>
      <View style={styles.day}>
        <Text style={styles.dayNumber}>{date.getUTCDate()}</Text>
        <Text style={styles.dayMonth}>{date.toLocaleDateString(locale, { month: "short", timeZone: "UTC" })}</Text>
      </View>
      <View style={styles.lineText}>
        <Text style={styles.lineTitle} numberOfLines={1}>
          {line.groupName}
        </Text>
        <View style={styles.lineSub}>
          <Text style={styles.lineSubText}>
            {received ? t("statement.yourPot", { number: line.round }) : t("statement.round", { number: line.round })}
          </Text>
          {line.onTime === true ? (
            <Text style={[styles.tag, styles.tagOk]}>{t("statement.onTime")}</Text>
          ) : line.onTime === false ? (
            <Text style={[styles.tag, styles.tagLate]}>{t("statement.late")}</Text>
          ) : null}
        </View>
      </View>
      <Text style={[styles.amount, received && styles.amountIn]}>{amount}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 20 },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    padding: 20,
    borderRadius: 22,
    backgroundColor: colors.indigo,
  },
  rate: { fontFamily: fonts.display, fontSize: 20, color: colors.white },
  summaryText: { flex: 1, gap: 2 },
  big: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: colors.white },
  light: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.onDark, opacity: 0.85 },
  filters: { flexDirection: "row", gap: 8 },
  filter: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  filterOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  filterText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  filterTextOn: { color: colors.white },
  empty: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  month: { gap: 10 },
  monthHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  monthTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.indigo },
  monthSum: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  box: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
  },
  line: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  day: { width: 42, alignItems: "center" },
  dayNumber: { fontFamily: fonts.display, fontSize: 20, lineHeight: 24, color: colors.indigo },
  dayMonth: { fontFamily: fonts.body, fontSize: 11, color: colors.muted },
  lineText: { flex: 1, minWidth: 0, gap: 2 },
  lineTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  lineSub: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  lineSubText: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  tag: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  tagOk: { backgroundColor: "#E3F3EA", color: colors.paid },
  tagLate: { backgroundColor: "#FDE8E6", color: colors.problem },
  amount: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.indigo },
  amountIn: { color: colors.paid },
});
