import type { Statement, StatementLine } from "@novi/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Href, router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getStatement } from "../../api/news";
import { formatFcfa } from "../../lib/format";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";
import { CowrieMark } from "../BottomBar";
import { LineIcon } from "../LineIcon";

// Her transactions in Historique (D92; redrawn in D122 from canvas boards 38
// and 39). What still needs her eye sits apart at the top, "En cours": a
// payment not confirmed yet or that failed, and a share the group's advances
// covered that she has not repaid. Below, month by month, the money that
// moved. "Payé" shows only money that left and was confirmed, "Reçu" only
// money that came in; when nothing came in yet, it says when her pot comes.
// Every line opens its round, where the details are.
type Filter = "ALL" | "PAID" | "RECEIVED";

const OUT = new Set<StatementLine["kind"]>(["PAID", "ADVANCE"]);
const IN = new Set<StatementLine["kind"]>(["RECEIVED", "ADVANCE_BACK"]);
const short = (amount: number) => formatFcfa(amount).replace(" FCFA", " F");
const open = (l: StatementLine) => (l.kind === "FAILED" || l.kind === "PENDING" || (l.kind === "COVERED" && !l.repaid));

export function StatementView({ nextPot }: { nextPot: { pot: number; date: string; group: string } | null }) {
  const { t, i18n } = useTranslation();
  const [statement, setStatement] = useState<Statement | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [group, setGroup] = useState<string | null>(null);

  useEffect(() => {
    getStatement()
      .then(setStatement)
      .catch(() => setStatement({ lines: [] }));
  }, []);

  const locale = i18n.language === "en" ? "en-GB" : "fr-FR";
  const all = statement?.lines ?? [];
  const groups = [...new Map(all.map((l) => [l.groupId, l.groupName])).entries()];
  const mine = all.filter((l) => group === null || l.groupId === group);
  const waiting = filter === "ALL" ? mine.filter(open) : [];
  const lines = mine.filter((l) =>
    filter === "ALL" ? !open(l) && l.kind !== "COVERED" : filter === "PAID" ? OUT.has(l.kind) : IN.has(l.kind),
  );
  const months = new Map<string, StatementLine[]>();
  for (const l of lines) {
    const key = l.at.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), l]);
  }
  const potDay = nextPot
    ? new Date(`${nextPot.date}T12:00:00Z`).toLocaleDateString(locale, {
        weekday: "long",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "";

  return (
    <View style={styles.wrap}>
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

      {waiting.length > 0 ? (
        <View style={[styles.box, styles.boxWaiting]}>
          <Text style={styles.waitingTitle}>{t("statement.inProgress")}</Text>
          {waiting.map((l) => (
            <Row key={l.id} line={l} locale={locale} />
          ))}
        </View>
      ) : null}

      {statement && lines.length === 0 && waiting.length === 0 ? (
        filter === "RECEIVED" ? (
          <View style={[styles.box, styles.emptyBox]}>
            <CowrieMark size={36} fill={colors.yourTurn} />
            <Text style={styles.emptyTitle}>{t("statement.nothingIn")}</Text>
            {nextPot ? (
              <Text style={styles.emptyText}>
                {t("statement.potComes", { pot: short(nextPot.pot), date: potDay, group: nextPot.group })}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.empty}>{t(filter === "PAID" ? "statement.nothingOut" : "statement.empty")}</Text>
        )
      ) : null}

      {[...months.entries()].map(([month, items]) => {
        const sum = (set: Set<StatementLine["kind"]>) =>
          items.filter((l) => set.has(l.kind)).reduce((s, l) => s + l.amountFcfa, 0);
        const title = new Date(`${month}-15T12:00:00Z`).toLocaleDateString(locale, {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        });
        return (
          <View key={month} style={styles.month}>
            <Text style={styles.monthTitle}>{title.charAt(0).toUpperCase() + title.slice(1)}</Text>
            <View style={styles.box}>
              {items.map((l, i) => (
                <Row key={l.id} line={l} locale={locale} first={i === 0} />
              ))}
              <View style={styles.totalRow}>
                {filter !== "RECEIVED" ? (
                  <Text style={styles.totalText}>{t("statement.totalOut", { amount: short(sum(OUT)) })}</Text>
                ) : null}
                {filter !== "PAID" ? (
                  <Text style={[styles.totalText, styles.in]}>{t("statement.totalIn", { amount: short(sum(IN)) })}</Text>
                ) : null}
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

function Row({ line, locale, first = false }: { line: StatementLine; locale: string; first?: boolean }) {
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
            : line.kind === "ADVANCE"
              ? { text: t("statement.advanceTag"), style: styles.tagGrey }
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
  const isIn = IN.has(line.kind);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/groups/${line.groupId}/rounds/${line.round}` as Href)}
      style={[styles.row, first && styles.rowFirst]}
    >
      <Text style={styles.date}>{date}</Text>
      <View style={styles.detail}>
        <Text style={styles.cellBold} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {line.groupName}
        </Text>
        {line.kind === "PAID" && (line.advanceFcfa ?? 0) > 0 ? (
          <Text style={styles.sub} numberOfLines={1}>
            {t("statement.withAdvance", { amount: short(line.advanceFcfa ?? 0) })}
          </Text>
        ) : null}
        {tag ? <Text style={[styles.tag, tag.style]}>{tag.text}</Text> : null}
      </View>
      <Text style={[styles.amount, isIn && styles.in, line.kind === "FAILED" && styles.struck]}>
        {isIn ? `+${short(line.amountFcfa)}` : short(line.amountFcfa)}
      </Text>
      <LineIcon name="chevron" size={16} color={colors.action} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
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
  emptyBox: { alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 22 },
  emptyTitle: { textAlign: "center", fontFamily: fonts.bodyBold, fontSize: 17, color: colors.indigo },
  emptyText: { textAlign: "center", fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.muted },
  month: { gap: 8 },
  monthTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.indigo },
  box: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  boxWaiting: { borderWidth: 2, borderColor: colors.accent },
  waitingTitle: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.accent, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  rowFirst: { borderTopWidth: 0 },
  date: { width: 40, fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  detail: { flex: 1, minWidth: 0, gap: 2 },
  cellBold: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  amount: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  in: { color: colors.paid },
  struck: { color: colors.muted, textDecorationLine: "line-through" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 2,
    borderTopColor: colors.line,
  },
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
  tagOk: { backgroundColor: colors.paidSoft, color: colors.paid },
  tagLate: { backgroundColor: colors.problemSoft, color: colors.problem },
  tagWait: { backgroundColor: colors.mist, color: colors.action },
  tagTurn: { backgroundColor: colors.turnSoft, color: colors.turnText },
  tagGrey: { backgroundColor: colors.shell, color: colors.muted },
});
