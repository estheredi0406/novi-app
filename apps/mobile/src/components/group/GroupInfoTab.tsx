import type { GroupDetail, RoundSummary } from "@novi/shared";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { formatFcfa, shortDay } from "../../lib/format";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";
import { Glyph } from "../art/Glyph";
import { RulesCard } from "../RulesCard";
import { GroupHelpPanel } from "./GroupHelpPanel";
import { HelpDot, Sheet } from "../Sheet";

// The "Le groupe" tab: who receives, and on which day
// (D122: every round always shown, each saying in words where it
// stands, her own line in indigo); the caisse de secours, explained behind
// "?"; the rules and the register one tap away.
export function GroupInfoTab({
  group,
  rounds,
  memberId,
  onChanged,
}: {
  group: GroupDetail;
  rounds: RoundSummary[];
  memberId: string;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [sheet, setSheet] = useState<"caisse" | "rules" | null>(null);

  const seatFor = (number: number) =>
    group.seats.find((s) => s.payoutPosition === number);
  const nameFor = (r: RoundSummary) => {
    const seat = seatFor(r.number);
    return seat?.memberId === memberId
      ? t("groupView.you")
      : (seat?.displayName ?? r.beneficiaryName);
  };
  const mine = rounds.find((r) => seatFor(r.number)?.memberId === memberId);

  const lastDay = rounds.at(-1)?.dueDate;
  const pot = formatFcfa(group.rules.amountFcfa * group.rules.size).replace(" FCFA", " F");
  const longDay = (iso: string) => shortDay(iso, lang);

  const reserve = group.reserve;
  const caisseText = t("caisse.body");

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t("groupInfo.whoWhen")}</Text>
      <Text style={styles.lede}>{t("groupInfo.lede", { pot })}</Text>
      <View style={styles.list}>
        <View style={styles.headRow}>
          <Text style={styles.headText}>{t("groupInfo.colWho")}</Text>
          <Text style={styles.headText}>{t("groupInfo.colWhere")}</Text>
        </View>
        {rounds.map((r) => {
          const now = r.isCurrent;
          const isMine = r === mine;
          const seat = seatFor(r.number);
          const status = seat?.exitReason
            ? { text: t(seat.exitReason === "DEATH" ? "groupView.toKin" : "groupView.left"), kind: "next" as const }
            : r.payoutStatus === "PAID"
              ? r.receipt === "DISPUTED"
                ? { text: t("groupView.disputed"), kind: "problem" as const }
                : { text: t(isMine ? "groupInfo.youGot" : "groupInfo.got", { pot }), kind: "done" as const }
              : now
                ? { text: t(isMine ? "groupInfo.youGetNow" : "groupInfo.getsNow"), kind: "now" as const }
                : isMine
                  ? { text: t("groupInfo.yourPot"), kind: "mine" as const }
                  : { text: t("groupInfo.later"), kind: "next" as const };
          return (
            <View key={r.number} style={[styles.row, isMine && styles.rowMine]}>
              <View style={[styles.num, isMine && styles.numMine]}>
                <Text style={[styles.numText, isMine && styles.numTextMine]}>{r.number}</Text>
              </View>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>
                  {nameFor(r)}
                </Text>
                <Text style={styles.day}>
                  {now ? t("groupInfo.dayNow", { date: longDay(r.dueDate) }) : longDay(r.dueDate)}
                </Text>
              </View>
              <View style={[styles.pill, styles[`pill_${status.kind}`]]}>
                {status.kind === "done" ? <Glyph name="check" color={colors.paid} /> : null}
                <Text style={[styles.pillText, styles[`pillText_${status.kind}`]]}>{status.text}</Text>
              </View>
            </View>
          );
        })}
      </View>
      {lastDay ? <Text style={styles.foot}>{t("groupInfo.cycleEnds", { date: longDay(lastDay) })}</Text> : null}

      {group.state === "ACTIVE" ? (
        <GroupHelpPanel groupId={group.id} onChanged={onChanged} />
      ) : null}

      {reserve ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t("caisse.title")}. ${caisseText}`}
          onPress={() => setSheet("caisse")}
          style={styles.tile}
        >
          <Svg width={24} height={24} viewBox="0 0 24 24">
            <Path
              d="M12 3 L20 6 V12 C20 16.5 16.5 19.8 12 21 C7.5 19.8 4 16.5 4 12 V6 Z M8.5 12 L11 14.5 L15.5 9.5"
              stroke={colors.paid}
              strokeWidth={2}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </Svg>
          <Text style={styles.tileText}>{t("caisse.active")}</Text>
          <HelpDot
            label={t("caisse.what")}
            onPress={() => setSheet("caisse")}
          />
        </Pressable>
      ) : null}

      <View style={styles.pair}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setSheet("rules")}
          style={[styles.tile, styles.half]}
        >
          <Text style={styles.tileText}>{t("groupInfo.rules")}</Text>
          <Glyph name="chevron" color={colors.indigo} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: "/groups/[id]/ledger",
              params: { id: group.id },
            })
          }
          style={[styles.tile, styles.half]}
        >
          <Text style={styles.tileText}>{t("groupInfo.ledger")}</Text>
          <Glyph name="chevron" color={colors.indigo} />
        </Pressable>
      </View>

      <Sheet
        visible={sheet === "caisse"}
        title={t("caisse.title")}
        listenText={`${t("caisse.title")}. ${caisseText}`}
        onClose={() => setSheet(null)}
      >
        <Text style={styles.sheetText}>{caisseText}</Text>
        {reserve ? (
          <View style={styles.facts}>
            <View style={[styles.fact, styles.line]}>
              <Text style={styles.factLabel}>{t("caisse.setAside")}</Text>
              <Text style={styles.factValue}>
                {formatFcfa(reserve.mine?.paidFcfa ?? 0)}
              </Text>
            </View>
            <View style={[styles.fact, styles.line]}>
              <Text style={styles.factLabel}>{t("caisse.mine")}</Text>
              <Text style={styles.factValue}>
                {formatFcfa(reserve.mine?.nowFcfa ?? 0)}
              </Text>
            </View>
            <View style={[styles.fact, styles.line]}>
              <Text style={styles.factLabel}>{t("caisse.group")}</Text>
              <Text style={styles.factValue}>
                {formatFcfa(Math.max(0, reserve.balanceFcfa))}
              </Text>
            </View>
            <View style={styles.fact}>
              <Text style={styles.factLabel}>{t("caisse.end")}</Text>
              <Text style={styles.factValue}>{t("caisse.returned")}</Text>
            </View>
          </View>
        ) : null}
      </Sheet>

      <Sheet
        visible={sheet === "rules"}
        title={t("groupInfo.rules")}
        listenText={t("groupInfo.rules")}
        onClose={() => setSheet(null)}
      >
        <RulesCard rules={group.rules} mfiName={group.mfiName} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.indigo },
  list: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  lede: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: -8 },
  headRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: colors.shell,
  },
  headText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.muted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    minHeight: 56,
  },
  rowMine: { backgroundColor: colors.mist, borderLeftWidth: 4, borderLeftColor: colors.indigo, paddingLeft: 10 },
  num: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.shell,
    alignItems: "center",
    justifyContent: "center",
  },
  numMine: { backgroundColor: colors.indigo },
  numText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.indigo },
  numTextMine: { color: colors.white },
  who: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 22, color: colors.indigo },
  day: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "48%",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
  },
  pill_done: { backgroundColor: colors.paidSoft },
  pill_now: { backgroundColor: colors.turnSoft },
  pill_mine: { backgroundColor: colors.turnSoft },
  pill_next: { backgroundColor: colors.shell },
  pill_problem: { backgroundColor: colors.problemSoft },
  pillText: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 13, lineHeight: 17, textAlign: "right" },
  pillText_done: { color: colors.paid },
  pillText_now: { color: colors.turnText },
  pillText_mine: { color: colors.turnText },
  pillText_next: { color: colors.muted },
  pillText_problem: { color: colors.problem },
  foot: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: -6 },
  more: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  link: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.indigo,
    textDecorationLine: "underline",
  },
  tile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  tileText: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.indigo,
  },
  pair: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  sheetText: {
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 25,
    color: colors.ink,
  },
  facts: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  fact: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  line: { borderBottomWidth: 1, borderBottomColor: colors.line },
  factLabel: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  factValue: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.ink,
    flexShrink: 1,
    textAlign: "right",
  },
});
