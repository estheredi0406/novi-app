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
import { HelpDot, Sheet } from "../Sheet";

// How many turns after the current one the list shows before "Voir les 15".
const AHEAD = 4;

// The "Le groupe" tab (approved design F3): who receives, and on which day,
// readable with fifteen members; the caisse de secours, explained behind
// "?"; the rules and the register one tap away.
export function GroupInfoTab({
  group,
  rounds,
  memberId,
}: {
  group: GroupDetail;
  rounds: RoundSummary[];
  memberId: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [all, setAll] = useState(false);
  const [sheet, setSheet] = useState<"caisse" | "rules" | null>(null);

  const seatFor = (number: number) => group.seats.find((s) => s.payoutPosition === number);
  const nameFor = (r: RoundSummary) => {
    const seat = seatFor(r.number);
    return seat?.memberId === memberId ? t("groupView.you") : (seat?.displayName ?? r.beneficiaryName);
  };
  const received = rounds.filter((r) => r.payoutStatus === "PAID");
  const currentIndex = rounds.findIndex((r) => r.isCurrent);
  const from = currentIndex >= 0 ? currentIndex : received.length;
  const mine = rounds.find((r) => seatFor(r.number)?.memberId === memberId);

  // Collapsed: the pots already received in one line, the current turn, the
  // next few, and her own turn if it comes later.
  const shown = all
    ? rounds
    : rounds.filter(
        (r, i) => (i >= from && i <= from + AHEAD) || (r === mine && r.payoutStatus !== "PAID"),
      );
  const later = all ? [] : rounds.filter((r, i) => i > from + AHEAD && r !== mine);
  const lastDay = rounds.at(-1)?.dueDate;

  const reserve = group.reserve;
  const caisseText = t("caisse.body", { percent: reserve?.percent ?? 2 });

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t("groupInfo.whoWhen")}</Text>
      <View style={styles.list}>
        {!all && received.length > 0 ? (
          <View style={[styles.row, styles.rowSoft]}>
            <Text style={[styles.day, styles.receivedCount]}>
              ✓ {t("groupInfo.received", { count: received.length })}
            </Text>
            <Text style={styles.names} numberOfLines={1}>
              {received.map(nameFor).join(", ")}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setAll(true)} hitSlop={8}>
              <Text style={styles.link}>{t("groupInfo.see")}</Text>
            </Pressable>
          </View>
        ) : null}

        {shown.map((r) => {
          const now = r.isCurrent;
          const isMine = r === mine;
          const seat = seatFor(r.number);
          return (
            <View key={r.number} style={[styles.row, now && styles.rowNow, isMine && styles.rowMine]}>
              <Text style={[styles.day, now && styles.dayNow, isMine && styles.dayMine]}>
                {shortDay(r.dueDate, lang)}
              </Text>
              <Text style={[styles.name, isMine && styles.nameMine]} numberOfLines={1}>
                {nameFor(r)}
              </Text>
              {seat?.exitReason ? (
                <Text style={[styles.note, isMine && styles.dayMine]}>
                  {t(seat.exitReason === "DEATH" ? "groupView.toKin" : "groupView.left")}
                </Text>
              ) : r.payoutStatus === "PAID" ? (
                r.receipt === "DISPUTED" ? (
                  <Text style={[styles.note, styles.problem]}>{t("groupView.disputed")}</Text>
                ) : (
                  <Glyph name="check" color={isMine ? colors.white : colors.paid} />
                )
              ) : now ? (
                <Text style={[styles.nowTag, isMine && styles.dayMine]}>{t("groupInfo.thisTurn")}</Text>
              ) : null}
            </View>
          );
        })}

        {later.length > 0 ? (
          <View style={[styles.row, styles.rowLast]}>
            <Text style={styles.more}>
              {t("groupInfo.more", { count: later.length, date: lastDay ? shortDay(lastDay, lang) : "" })}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setAll(true)} hitSlop={8}>
              <Text style={styles.link}>{t("groupInfo.seeAll", { count: rounds.length })}</Text>
            </Pressable>
          </View>
        ) : all ? (
          <View style={[styles.row, styles.rowLast]}>
            <Pressable accessibilityRole="button" onPress={() => setAll(false)} hitSlop={8}>
              <Text style={styles.link}>{t("groupInfo.seeLess")}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

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
          <HelpDot label={t("caisse.what")} onPress={() => setSheet("caisse")} />
        </Pressable>
      ) : null}

      <View style={styles.pair}>
        <Pressable accessibilityRole="button" onPress={() => setSheet("rules")} style={[styles.tile, styles.half]}>
          <Text style={styles.tileText}>{t("groupInfo.rules")}</Text>
          <Glyph name="chevron" color={colors.indigo} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: "/groups/[id]/ledger", params: { id: group.id } })}
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
              <Text style={styles.factValue}>{t("caisse.percent", { percent: reserve.percent })}</Text>
            </View>
            <View style={[styles.fact, styles.line]}>
              <Text style={styles.factLabel}>{t("caisse.group")}</Text>
              <Text style={styles.factValue}>{formatFcfa(Math.max(0, reserve.balanceFcfa))}</Text>
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
  list: { borderRadius: 18, borderWidth: 1.5, borderColor: colors.indigo, backgroundColor: colors.card, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    minHeight: 48,
  },
  rowLast: { borderBottomWidth: 0, justifyContent: "space-between" },
  rowSoft: { backgroundColor: colors.shell },
  rowNow: { backgroundColor: "#FFF4EC" },
  rowMine: { backgroundColor: colors.indigo },
  day: { width: 92, fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  dayNow: { fontFamily: fonts.bodyBold, color: colors.accent },
  dayMine: { fontFamily: fonts.bodyBold, color: colors.mist },
  receivedCount: { fontFamily: fonts.bodyBold, color: colors.paid },
  names: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  name: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  nameMine: { fontFamily: fonts.bodyBold, color: colors.white },
  note: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.muted },
  problem: { color: colors.problem },
  nowTag: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.accent, letterSpacing: 0.6, textTransform: "uppercase" },
  more: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  link: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.indigo, textDecorationLine: "underline" },
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
  tileText: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: colors.indigo },
  pair: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  sheetText: { fontFamily: fonts.body, fontSize: 17, lineHeight: 25, color: colors.ink },
  facts: { borderRadius: 16, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card },
  fact: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  line: { borderBottomWidth: 1, borderBottomColor: colors.line },
  factLabel: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  factValue: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink, flexShrink: 1, textAlign: "right" },
});
