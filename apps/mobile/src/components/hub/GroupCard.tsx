import type { GroupSummary } from "@novi/shared";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { errorKey } from "../../api/client";
import { callGroup } from "../../api/groups";
import { formatFcfa, shortDay } from "../../lib/format";
import { openCall } from "../../lib/openCall";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";
import { CowrieMark, openRound } from "../BottomBar";
import { ErrorMessage } from "../ErrorMessage";
import { LineIcon, type LineIconName } from "../LineIcon";
import { sheetColumn } from "../WebFrame";

// One running group on home (D92, redrawn in D121 from canvas boards 30 to
// 32): a square white panel under the pagne band that speaks only of her. One
// figure in large type: what she must pay (with the orange Payer button and,
// below, when her pot comes), else her pot to come, else the pot she received
// in green. Who receives this round is on the group page, not here. The
// group's actions (Appeler, Discussion, Plus) are plain blue links.
export function GroupCard({ group, width }: { group: GroupSummary; width: number }) {
  const { t, i18n } = useTranslation();
  const [more, setMore] = useState(false);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const round = group.currentRound;
  if (!round) return null;

  const owes = round.myStatus === "UNPAID" || round.myStatus === "FAILED";
  const pending = round.myStatus === "PENDING";
  const pot = formatFcfa(round.potFcfa).replace(" FCFA", " F");
  const day = (iso: string) => shortDay(iso, i18n.language);
  const amountDue = formatFcfa(group.amountFcfa + (round.advanceFcfa ?? 0)).replace(" FCFA", " F");
  // Her own pot: still to come, or already received (D121: home speaks of her).
  const myPot = round.myTurn;
  const potReceived = myPot?.payoutStatus === "PAID";

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
        <Text style={styles.name} numberOfLines={1}>
          {group.name}
        </Text>
        <LineIcon name="chevron" color={colors.action} />
      </Pressable>

      {owes ? (
        <>
          <Big small={t("hub.toPayBefore", { date: day(round.dueDate) })} amount={amountDue} />
          <Pressable accessibilityRole="button" onPress={() => openRound(group)} style={styles.pay}>
            <CowrieMark size={30} />
            <Text style={styles.payText}>{t("hub.pay", { amount: amountDue })}</Text>
          </Pressable>
          {myPot && !potReceived ? (
            <View style={styles.potRow}>
              <View style={styles.potIcon}>
                <CowrieMark size={22} fill={colors.yourTurn} />
              </View>
              <View>
                <Text style={styles.small}>{t("hub.yourPot")}</Text>
                <Text style={styles.potLine}>{t("hub.potLine", { pot, date: day(myPot.dueDate) })}</Text>
              </View>
            </View>
          ) : null}
        </>
      ) : (
        <>
          {pending ? (
            <Text style={[styles.status, styles.statusPending]}>{t("hub.payingText")}</Text>
          ) : (
            <View style={styles.okRow}>
              <LineIcon name="check" color={colors.paid} size={18} />
              <Text style={[styles.status, styles.statusPaid]}>
                {potReceived ? t("hub.gotPot") : t("hub.paidThisRound")}
              </Text>
            </View>
          )}
          {myPot && potReceived ? (
            <>
              <Big small={t("hub.gotPotOn", { date: day(myPot.dueDate) })} amount={pot} green />
              <Text style={styles.small}>{t("hub.keepPaying")}</Text>
            </>
          ) : myPot ? (
            <Big small={t("hub.yourPotOn", { date: day(myPot.dueDate) })} amount={pot} />
          ) : null}
        </>
      )}

      <View style={styles.actions}>
        <Action icon="phone" label={t("hub.call")} onPress={() => void call()} busy={calling} />
        <Action
          divider
          icon="chat"
          label={t("hub.chat")}
          onPress={() => open("discussion")}
          badge={group.unreadMessages}
          badgeLabel={t("hub.unread", { count: group.unreadMessages })}
        />
        <Action divider icon="more" label={t("hub.more")} onPress={() => setMore(true)} />
      </View>
      <ErrorMessage messageKey={error} />

      <Modal visible={more} transparent animationType="slide" onRequestClose={() => setMore(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMore(false)} accessibilityLabel={t("hub.close")} />
        <SafeAreaView edges={["bottom"]} style={[styles.sheet, sheetColumn]}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{group.name}</Text>
          <Text style={styles.sheetSub}>{t("hub.moreSub")}</Text>
          <MoreRow icon="swap" title={t("hub.swap")} sub={t("hub.swapSub")} onPress={() => go("/groups/[id]/swap")} />
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

// One figure in large type, always hers: what she owes, her pot, or the pot
// she received (green).
function Big({ small, amount, green = false }: { small: string; amount: string; green?: boolean }) {
  return (
    <View style={styles.big}>
      <Text style={styles.small}>{small}</Text>
      <Text style={[styles.amount, green && styles.amountGreen]}>{amount}</Text>
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
  divider = false,
}: {
  icon: LineIconName;
  label: string;
  onPress: () => void;
  busy?: boolean;
  badge?: number;
  badgeLabel?: string;
  divider?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge > 0 && badgeLabel ? `${label}, ${badgeLabel}` : label}
      onPress={onPress}
      disabled={busy}
      style={[styles.action, divider && styles.actionDivider, busy && styles.busy]}
    >
      <LineIcon name={icon} size={18} color={colors.action} />
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
    paddingHorizontal: 24,
    paddingTop: 18,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 17, color: colors.indigo },
  big: { gap: 2 },
  small: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.muted },
  amount: { fontFamily: fonts.display, fontSize: 34, lineHeight: 42, color: colors.indigo },
  amountGreen: { color: colors.paid },
  okRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  status: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 21 },
  statusPaid: { color: colors.paid },
  statusPending: { color: colors.action },
  potRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 14,
  },
  potIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.turnSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  potLine: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.indigo },
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
  actions: {
    flexDirection: "row",
    marginHorizontal: -24,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  action: {
    flex: 1,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  actionDivider: { borderLeftWidth: 1, borderLeftColor: colors.line },
  busy: { opacity: 0.5 },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.action },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 4,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.white },
  headText: { flex: 1, minWidth: 0, gap: 1 },
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
