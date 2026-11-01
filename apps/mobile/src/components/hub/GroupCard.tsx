import type { GroupSummary } from "@novi/shared";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { errorKey } from "../../api/client";
import { callGroup } from "../../api/groups";
import { daysUntil, formatFcfa, shortDay } from "../../lib/format";
import { openCall } from "../../lib/openCall";
import { scheduleText } from "../../lib/rulesText";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";
import { SeatRing } from "../art/SeatRing";
import { CowrieMark, openRound } from "../BottomBar";
import { ErrorMessage } from "../ErrorMessage";
import { LineIcon, type LineIconName } from "../LineIcon";

// One running group on home (D92, boards E1, E2 and E7): this round as a ring
// of members, what she owes and by when, who receives, the Payer button, and
// the group's own actions on the card itself (Appeler, Discussion, Plus), so
// it is never in doubt which group they act on.
export function GroupCard({ group, width }: { group: GroupSummary; width: number }) {
  const { t, i18n } = useTranslation();
  const [more, setMore] = useState(false);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const round = group.currentRound;
  if (!round) return null;

  const owes = round.myStatus === "UNPAID" || round.myStatus === "FAILED";
  const pending = round.myStatus === "PENDING";
  const mySeat = round.myTurn ? round.myTurn.number - 1 : null;
  const receiverSeat = round.number - 1;
  const allPaid = round.paidCount >= group.size;
  const days = daysUntil(round.dueDate);
  const pot = formatFcfa(round.potFcfa).replace(" FCFA", " F");
  const day = (iso: string) => shortDay(iso, i18n.language);
  const myTurnAhead =
    round.myTurn && round.myTurn.number > round.number && round.myTurn.payoutStatus !== "PAID" ? round.myTurn : null;

  const open = (tab?: string) =>
    router.push({ pathname: "/groups/[id]", params: tab ? { id: group.id, tab } : { id: group.id } });

  async function call() {
    setCalling(true);
    setError(null);
    try {
      const { url } = await callGroup(group.id);
      await openCall(url, group.name);
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setCalling(false);
    }
  }

  const go = (path: string) => {
    setMore(false);
    router.push({ pathname: path as never, params: { id: group.id } });
  };

  return (
    <View style={[styles.card, { width }]}>
      <Pressable accessibilityRole="button" onPress={() => open()} style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.name} numberOfLines={1}>
            {group.name}
          </Text>
          <Text style={styles.sub}>
            {t("hub.roundOf", {
              number: round.number,
              size: group.size,
              schedule: scheduleText(t, group.frequency, group.dueDay),
            })}
          </Text>
        </View>
        <LineIcon name="chevron" color={colors.muted} />
      </Pressable>

      <View style={styles.middle}>
        <SeatRing paid={round.paidSeats} mine={mySeat} receiver={receiverSeat} size={142}>
          {owes ? (
            <>
              <Text style={styles.amount}>{String(group.amountFcfa).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}</Text>
              <Text style={styles.amountUnit}>{t("hub.toPay")}</Text>
            </>
          ) : pending ? (
            <Text style={styles.pendingMark}>{t("hub.paying")}</Text>
          ) : (
            <>
              <Text style={styles.tick}>✓</Text>
              <Text style={styles.paidMark}>{t("hub.paid")}</Text>
            </>
          )}
        </SeatRing>

        <View style={styles.facts}>
          {owes ? (
            <Text style={styles.fact}>
              <Text style={styles.bold}>{t("hub.before", { date: day(round.dueDate) })}</Text>
              {"\n"}
              <Text style={styles.muted}>{whenWords(t, days)}</Text>
            </Text>
          ) : pending ? (
            <Text style={styles.fact}>{t("hub.payingText")}</Text>
          ) : allPaid ? (
            <Text style={styles.fact}>
              <Text style={styles.bold}>{t("hub.allPaid")}</Text>
              {"\n"}
              <Text style={styles.muted}>
                {round.isMyTurn
                  ? t("hub.youReceive", { pot })
                  : t("hub.potLeaves", { name: round.receiverName, mfi: group.mfiName })}
              </Text>
            </Text>
          ) : null}
          {!allPaid || owes ? (
            <Legend color={colors.paid} text={t("hub.paidCount", { paid: round.paidCount, size: group.size })} />
          ) : null}
          {!round.isMyTurn && !(allPaid && !owes) ? (
            <Legend color={colors.yourTurn} text={t("hub.receives", { name: round.receiverName, pot })} />
          ) : null}
          {mySeat !== null && !round.isMyTurn ? (
            <Legend color={colors.accent} text={t("hub.yourSeat", { number: mySeat + 1 })} />
          ) : null}
          {!owes && round.onTimeStreak > 1 ? (
            <Text style={styles.fact}>{t("hub.streak", { count: round.onTimeStreak })}</Text>
          ) : null}
        </View>
      </View>

      {round.isMyTurn ? (
        <TurnBox title={t("hub.yourTurnToday")} text={t("hub.youReceive", { pot })} />
      ) : !owes && myTurnAhead ? (
        <TurnBox title={t("hub.yourTurn", { date: day(myTurnAhead.dueDate) })} text={t("hub.youReceive", { pot })} />
      ) : null}

      {owes ? (
        <Pressable accessibilityRole="button" onPress={() => openRound(group)} style={styles.pay}>
          <CowrieMark size={30} />
          <Text style={styles.payText}>{t("hub.pay", { amount: formatFcfa(group.amountFcfa).replace(" FCFA", " F") })}</Text>
        </Pressable>
      ) : null}

      <View style={styles.actions}>
        <Action icon="phone" label={t("hub.call")} onPress={() => void call()} busy={calling} />
        <Action
          icon="chat"
          label={t("hub.chat")}
          onPress={() => open("discussion")}
          badge={group.unreadMessages}
          badgeLabel={t("hub.unread", { count: group.unreadMessages })}
        />
        <Action icon="more" label={t("hub.more")} onPress={() => setMore(true)} />
      </View>
      <ErrorMessage messageKey={error} />

      <Modal visible={more} transparent animationType="slide" onRequestClose={() => setMore(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMore(false)} accessibilityLabel={t("hub.close")} />
        <SafeAreaView edges={["bottom"]} style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{group.name}</Text>
          <Text style={styles.sheetSub}>{t("hub.moreSub")}</Text>
          <MoreRow icon="swap" title={t("hub.swap")} sub={t("hub.swapSub")} onPress={() => go("/groups/[id]/swap")} />
          <MoreRow icon="hand" title={t("hub.advance")} sub={t("hub.advanceSub")} onPress={() => go("/groups/[id]/advance")} />
          <MoreRow
            icon="calendar"
            title={t("hub.meetings")}
            sub={t("hub.meetingsSub")}
            onPress={() => go("/groups/[id]/meetings")}
          />
          <MoreRow
            icon="clock"
            title={t("hub.rounds")}
            sub={t("hub.roundsSub")}
            onPress={() => {
              setMore(false);
              open("cotisation");
            }}
          />
          <MoreRow
            icon="groups"
            title={t("hub.members")}
            sub={t("hub.membersSub", { count: group.size })}
            onPress={() => {
              setMore(false);
              open("groupe");
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function whenWords(t: ReturnType<typeof useTranslation>["t"], days: number): string {
  if (days <= 0) return t("home.today");
  if (days === 1) return t("home.tomorrow");
  if (days < 14) return t("home.inDays", { count: days });
  return t("home.inWeeks", { count: Math.round(days / 7) });
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <View style={styles.legend}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{text}</Text>
    </View>
  );
}

function TurnBox({ title, text }: { title: string; text: string }) {
  return (
    <View style={styles.turn}>
      <View style={styles.turnIcon}>
        <LineIcon name="calendar" color={colors.indigo} size={22} />
      </View>
      <View style={styles.headText}>
        <Text style={styles.turnTitle}>{title}</Text>
        <Text style={styles.turnText}>{text}</Text>
      </View>
    </View>
  );
}

function Action({
  icon,
  label,
  onPress,
  busy,
  badge = 0,
  badgeLabel,
}: {
  icon: LineIconName;
  label: string;
  onPress: () => void;
  busy?: boolean;
  badge?: number;
  badgeLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge > 0 && badgeLabel ? `${label}, ${badgeLabel}` : label}
      onPress={onPress}
      disabled={busy}
      style={[styles.action, busy && styles.busy]}
    >
      <LineIcon name={icon} size={18} />
      <Text style={styles.actionText}>{label}</Text>
      {badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? "99+" : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function MoreRow({ icon, title, sub, onPress }: { icon: LineIconName; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.moreRow}>
      <View style={styles.moreIcon}>
        <LineIcon name={icon} />
      </View>
      <View style={styles.headText}>
        <Text style={styles.moreTitle}>{title}</Text>
        <Text style={styles.moreSub}>{sub}</Text>
      </View>
      <LineIcon name="chevron" color={colors.muted} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 20,
    gap: 16,
    elevation: 4,
    shadowColor: colors.indigo,
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  headText: { flex: 1, minWidth: 0, gap: 1 },
  name: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  middle: { flexDirection: "row", alignItems: "center", gap: 16 },
  amount: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, color: colors.indigo },
  amountUnit: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  tick: { fontFamily: fonts.bodyBold, fontSize: 30, lineHeight: 34, color: colors.paid },
  paidMark: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.paid },
  pendingMark: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.lagoon },
  facts: { flex: 1, gap: 10 },
  fact: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.ink },
  bold: { fontFamily: fonts.bodyBold },
  muted: { color: colors.muted },
  legend: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.ink },
  turn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#FDF1DC",
  },
  turnIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.yourTurn,
    alignItems: "center",
    justifyContent: "center",
  },
  turnTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  turnText: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  pay: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  payText: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.white },
  actions: { flexDirection: "row", gap: 10 },
  action: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: colors.mist,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  busy: { opacity: 0.5 },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.lagoon },
  badge: {
    position: "absolute",
    top: -6,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 4,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 10, color: colors.white },
  backdrop: { flex: 1, backgroundColor: "rgba(6,41,74,0.5)" },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
  },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, marginBottom: 12 },
  sheetTitle: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.indigo },
  sheetSub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted, marginBottom: 6 },
  moreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  moreIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.mist,
    alignItems: "center",
    justifyContent: "center",
  },
  moreTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  moreSub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
});
