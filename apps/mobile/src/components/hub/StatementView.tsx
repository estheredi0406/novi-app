import type { SavingsRecord, Statement, StatementLine } from "@novi/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Href, router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getStatement } from "../../api/news";
import { formatFcfa } from "../../lib/format";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";
import { SeatRing } from "../art/SeatRing";

// Her transactions on "Mon relevé" (D92, board E6), as a table: her on-time
// share on a ring at the top (the same facts FUCEC sees if she shares her
// record), then every franc she paid or received, month by month, with the
// group and the turn. Her advance has its own line (D103); a share the
// advances covered shows with its deadline (D104); a payment pending or not
// confirmed shows too, and opens the round to say what happened.
type Filter = "ALL" | "PAID" | "RECEIVED";

const OUT = new Set<StatementLine["kind"]>(["PAID", "ADVANCE", "PENDING", "FAILED"]);
const IN = new Set<StatementLine["kind"]>(["RECEIVED", "ADVANCE_BACK"]);
const short = (amount: number) => formatFcfa(amount).replace(" FCFA", "");

export function StatementView({ record }: { record: SavingsRecord }) {
  const { t, i18n } = useTranslation();
  const [statement, setStatement] = useState<Statement | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [group, setGroup] = useState<string | null>(null);

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
  const all = statement?.lines ?? [];
  const groups = [...new Map(all.map((l) => [l.groupId, l.groupName])).entries()];
  const lines = all.filter(
    (l) =>
      (group === null || l.groupId === group) &&
      (filter === "ALL" || (filter === "PAID" ? OUT.has(l.kind) : IN.has(l.kind))),
  );
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
          <Chip
            key={f}
            on={filter === f}
            label={t(`statement.${f === "ALL" ? "all" : f === "PAID" ? "paid" : "received"}`)}
            onPress={() => setFilter(f)}
          />
        ))}
      </View>
      {groups.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          <Chip on={group === null} label={t("statement.allGroups")} onPress={() => setGroup(null)} />
          {groups.map(([id, name]) => (
            <Chip key={id} on={group === id} label={name} onPress={() => setGroup(id)} />
          ))}
        </ScrollView>
      ) : null}

      {statement && lines.length === 0 ? <Text style={styles.empty}>{t("statement.empty")}</Text> : null}

      {[...months.entries()].map(([month, items]) => {
        const sum = (set: Set<StatementLine["kind"]>) =>
          items.filter((l) => set.has(l.kind) && l.kind !== "FAILED" && l.kind !== "PENDING").reduce((s, l) => s + l.amountFcfa, 0);
        const title = new Date(`${month}-15T12:00:00Z`).toLocaleDateString(locale, {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        });
        return (
          <View key={month} style={styles.month}>
            <Text style={styles.monthTitle}>{title.charAt(0).toUpperCase() + title.slice(1)}</Text>
            <View style={styles.box}>
              <View style={[styles.row, styles.head]}>
                <Text style={[styles.colDate, styles.headText]}>{t("statement.colDate")}</Text>
                <Text style={[styles.colDetail, styles.headText]}>{t("statement.colDetail")}</Text>
                <Text style={[styles.colNum, styles.headText]}>{t("statement.colPaid")}</Text>
                <Text style={[styles.colNum, styles.headText]}>{t("statement.colReceived")}</Text>
              </View>
              {items.map((l) => (
                <Row key={l.id} line={l} locale={locale} />
              ))}
              <View style={[styles.row, styles.totalRow]}>
                <Text style={[styles.colDate, styles.totalText]} />
                <Text style={[styles.colDetail, styles.totalText]}>{t("statement.total")}</Text>
                <Text style={[styles.colNum, styles.totalText]}>{short(sum(OUT))}</Text>
                <Text style={[styles.colNum, styles.totalText, styles.in]}>{short(sum(IN))}</Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.filter, on && styles.filterOn]}
    >
      <Text style={[styles.filterText, on && styles.filterTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Row({ line, locale }: { line: StatementLine; locale: string }) {
  const { t } = useTranslation();
  const date = new Date(line.at).toLocaleDateString(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const title =
    line.kind === "ADVANCE"
      ? t("statement.advance")
      : line.kind === "RECEIVED"
        ? t("statement.pot", { number: line.round })
        : line.kind === "ADVANCE_BACK"
          ? t("statement.advanceBack")
          : line.kind === "COVERED"
            ? t("statement.covered", { number: line.round })
            : t("statement.contribution", { number: line.round });
  const tag =
    line.kind === "PAID" && line.onTime === true
      ? { text: t("statement.onTime"), style: styles.tagOk }
      : line.kind === "PAID" && line.onTime === false
        ? { text: t("statement.late"), style: styles.tagLate }
        : line.kind === "PENDING"
          ? { text: t("statement.pending"), style: styles.tagWait }
          : line.kind === "FAILED"
            ? { text: line.reported ? t("statement.reported") : t("statement.failed"), style: styles.tagLate }
            : line.kind === "COVERED"
              ? line.repaid
                ? { text: t("statement.repaid"), style: styles.tagOk }
                : {
                    text: t("statement.repayBy", {
                      date: line.dueBy
                        ? new Date(line.dueBy).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" })
                        : "…",
                    }),
                    style: styles.tagTurn,
                  }
              : null;
  const struck = line.kind === "FAILED";
  // A payment to look at, or a share to repay, opens its round.
  const opens = line.kind === "FAILED" || line.kind === "PENDING" || (line.kind === "COVERED" && !line.repaid);
  const body = (
    <View style={styles.row}>
      <Text style={[styles.colDate, styles.cell]}>{date}</Text>
      <View style={styles.colDetail}>
        <Text style={styles.cellBold} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {line.groupName}
        </Text>
        {tag ? <Text style={[styles.tag, tag.style]}>{tag.text}</Text> : null}
      </View>
      <Text style={[styles.colNum, styles.cell, struck && styles.struck]}>
        {OUT.has(line.kind) ? short(line.amountFcfa) : ""}
      </Text>
      <Text style={[styles.colNum, styles.cell, styles.in]}>{IN.has(line.kind) ? short(line.amountFcfa) : ""}</Text>
    </View>
  );
  return opens ? (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/groups/${line.groupId}/rounds/${line.round}` as Href)}
    >
      {body}
    </Pressable>
  ) : (
    body
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
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
  month: { gap: 8 },
  monthTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.indigo },
  box: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  head: { backgroundColor: colors.shell, borderTopWidth: 0, paddingVertical: 8 },
  headText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.muted },
  colDate: { width: 42 },
  colDetail: { flex: 1, minWidth: 0, gap: 2 },
  colNum: { width: 62, textAlign: "right" },
  cell: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  cellBold: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  in: { color: colors.paid, fontFamily: fonts.bodyBold },
  struck: { color: colors.muted, textDecorationLine: "line-through" },
  totalRow: { borderTopWidth: 2 },
  totalText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  tag: {
    alignSelf: "flex-start",
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: "hidden",
    marginTop: 2,
  },
  tagOk: { backgroundColor: "#E3F3EA", color: colors.paid },
  tagLate: { backgroundColor: "#FDE8E6", color: colors.problem },
  tagWait: { backgroundColor: colors.mist, color: colors.lagoon },
  tagTurn: { backgroundColor: "#FDF1DC", color: "#8A5A00" },
});
