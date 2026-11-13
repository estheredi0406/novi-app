import type { GroupSummary, PotChoiceView } from "@novi/shared";
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
import { CycleRing } from "../art/CycleRing";
import { sheetColumn } from "../WebFrame";

// One running group on home (D92, D121, D122): a rounded white card riding over the pagne band, about her
// only. On the left, her cycle as a ring (CycleRing), the round in the
// middle. On the right, one figure in large type: what she must pay (orange,
// with the Payer button and, below, when her pot comes), else her pot to
// come, else the pot she received, in green. Who receives this round is on the
// group page, not here. Appeler, Discussion and Plus are plain blue links.
// D144: the big figure is the pot she will receive, said as such ("Vous
// recevrez le 14 nov."), never a bare amount that reads like a balance; under
// it, where it goes once she has chosen, with a link to change it while the
// choice is open.
export function GroupCard({
  group,
  width,
  choice = null,
}: {
  group: GroupSummary;
  width: number;
  choice?: PotChoiceView | null;
}) {
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
  const F = (n: number) => formatFcfa(n).replace(" FCFA", " F");
  const keep = Math.min(myPot?.keepFcfa ?? 0, round.potFcfa);
  const toPhone = round.potFcfa - keep;
  // D145: her pot is this round and has not reached her yet.
  const potNow = Boolean(myPot) && myPot!.number === round.number && !potReceived;
  const potLater = Boolean(myPot) && myPot!.number > round.number;
  const waitsAccount =
    potNow && myPot!.payoutStatus === "READY" && keep > 0 && choice?.accountStatus === "REQUESTED";
  // D151: her pot is this round and she has not said where it goes: ask her,
  // plainly, instead of a line saying it all goes to her phone.
  const mustChoose = potNow && Boolean(choice) && !choice!.chosen;
  const potState = !potNow
    ? null
    : mustChoose && (myPot!.payoutStatus === "READY" || myPot!.payoutStatus === "NOT_DUE" || myPot!.payoutStatus === "HELD")
      ? myPot!.payoutStatus === "READY"
        ? t("hub.potAsk")
        : t("hub.potFilling", { paid: round.paidCount, total: group.size })
      : waitsAccount
      ? t("hub.potWaitsAccount")
      : myPot!.payoutStatus === "NOT_DUE" || myPot!.payoutStatus === "HELD"
        ? t("hub.potFilling", { paid: round.paidCount, total: group.size })
        : myPot!.payoutStatus === "READY"
          ? t("hub.potReady") // D146: full, but not sent until the caisse releases it
          : myPot!.payoutStatus === "FAILED"
            ? t("hub.potFailed") // D146: never "en route" when it is stuck
            : t("hub.potOnWay");
  // Where her pot goes, once she has chosen (D144), with "Modifier" while open.
  const split = !myPot
    ? null
    : potReceived
      ? keep > 0 && toPhone > 0
        ? t("hub.keptToo", { kept: F(keep) })
        : null
      : keep >= round.potFcfa
        ? t("hub.splitAllSaved")
        : keep > 0
          ? t("hub.splitPart", { phone: F(toPhone), kept: F(keep) })
          : choice
            ? t("hub.splitAllPhone") // D147: never answered: all to her mobile money
            : null;
  const canChange = Boolean(choice) && !potReceived;
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("hub.openGroup", { name: group.name })}
        onPress={() => open()}
        style={styles.head}
      >
        <Text style={styles.name} numberOfLines={1}>
          {group.name}
        </Text>
        {/* D145: a clear round button to open the group, not a small arrow. */}
        <View style={styles.openBtn}>
          <LineIcon name="chevron" color={colors.white} size={26} />
        </View>
      </Pressable>

      <View style={styles.cycle}>
        <CycleRing
          rounds={group.size}
          current={round.number}
          state={owes ? "owe" : pending ? "pending" : "paid"}
          potRound={myPot?.number ?? null}
        >
          <Text style={styles.ringBig}>{t("hub.roundShort", { number: round.number })}</Text>
          <Text style={styles.ringSmall}>{t("hub.ofRounds", { total: group.size })}</Text>
        </CycleRing>
        {/* D145: one big figure, and only money she pays, money coming to
            her phone or money she got, always with a line saying which. */}
        <View style={styles.side}>
          {owes ? (
            <>
              <Text style={styles.small}>{t("hub.toPayBefore", { date: day(round.dueDate) })}</Text>
              <Text style={[styles.amount, styles.amountDue]} numberOfLines={1} adjustsFontSizeToFit>
                {amountDue}
              </Text>
            </>
          ) : pending ? (
            <Text style={[styles.status, styles.statusPending]}>{t("hub.payingText")}</Text>
          ) : potReceived ? (
            <>
              <View style={styles.okRow}>
                <LineIcon name="check" color={colors.paid} size={17} />
                <Text style={[styles.status, styles.statusPaid]}>{t("hub.gotPotShort")}</Text>
              </View>
              <Text style={styles.small}>
                {toPhone > 0
                  ? t("hub.phoneGot", { date: day(myPot!.dueDate) })
                  : t("hub.savedGot", { date: day(myPot!.dueDate) })}
              </Text>
              <Text style={[styles.amount, styles.amountGreen]} numberOfLines={1} adjustsFontSizeToFit>
                {F(toPhone > 0 ? toPhone : keep)}
              </Text>
            </>
          ) : potNow ? (
            <>
              <Text style={[styles.status, styles.statusTurn]}>{t("hub.yourTurnNow")}</Text>
              <Text style={[styles.small, styles.turnDetail]}>{potState}</Text>
              {/* D156: the whole pot here; where it goes, row by row, below. */}
              <Text style={styles.small}>{t("hub.yourPotLabel")}</Text>
              <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
                {pot}
              </Text>
            </>
          ) : (
            <>
              <View style={styles.okRow}>
                <LineIcon name="check" color={colors.paid} size={17} />
                <Text style={[styles.status, styles.statusPaid]}>{t("hub.paidThisRound")}</Text>
              </View>
              {round.nextDueDate ? (
                <>
                  <Text style={styles.small}>{t("hub.nextPayment", { date: day(round.nextDueDate) })}</Text>
                  <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
                    {F(group.amountFcfa)}
                  </Text>
                </>
              ) : (
                <Text style={styles.small}>{t("hub.lastPayment")}</Text>
              )}
            </>
          )}
        </View>
      </View>

      {owes ? (
        <Pressable accessibilityRole="button" onPress={() => openRound(group)} style={styles.pay}>
          <CowrieMark size={28} />
          <Text style={styles.payText}>{t("hub.pay", { amount: amountDue })}</Text>
        </Pressable>
      ) : null}
      {/* D145: the pot's size, said as hers, when, and where it comes from. */}
      {myPot && (potLater || (potNow && owes)) ? (
        <View style={styles.potRow}>
          <CowrieMark size={20} fill={colors.yourTurn} />
          <View style={styles.potTextBox}>
            <Text style={[styles.potText, styles.potBold]}>{t("hub.turnTitle", { date: day(myPot.dueDate) })}</Text>
            <Text style={styles.potText}>{t("hub.turnPot", { pot, count: group.size })}</Text>
          </View>
        </View>
      ) : null}
      {mustChoose ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: "/savings-choice" as never, params: { group: choice!.groupId } })}
          style={styles.choose}
        >
          <Text style={styles.chooseText}>{t("hub.chooseWhere")}</Text>
        </Pressable>
      ) : potNow && choice?.chosen ? (
        <View style={styles.splitBox}>
          {toPhone > 0 ? (
            <View style={styles.splitLine}>
              <LineIcon name="phone" color={colors.ink} size={18} />
              <Text style={styles.splitLabel}>{t("hub.toMobileMoney")}</Text>
              <Text style={styles.splitAmount}>{F(toPhone)}</Text>
            </View>
          ) : null}
          {keep > 0 ? (
            <View style={styles.splitLine}>
              <LineIcon name="hand" color={colors.ink} size={18} />
              <Text style={styles.splitLabel} numberOfLines={1}>
                {t("hub.toSavingsAt", { mfi: group.mfiName })}
              </Text>
              <Text style={styles.splitAmount}>{F(keep)}</Text>
            </View>
          ) : null}
          {canChange ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() =>
                router.push({ pathname: "/savings-choice" as never, params: { group: choice!.groupId } })
              }
              style={styles.splitChange}
            >
              <Text style={styles.splitLink}>{t("hub.changeChoice")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : split ? (
        <View style={styles.splitRow}>
          <Text style={styles.splitText}>{split}</Text>
          {canChange ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() =>
                router.push({ pathname: "/savings-choice" as never, params: { group: choice!.groupId } })
              }
            >
              <Text style={styles.splitLink}>{t("hub.changeChoice")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {owes && potReceived ? (
        <View style={styles.okRow}>
          <LineIcon name="check" color={colors.paid} size={17} />
          <Text style={[styles.small, styles.statusPaid]}>{t("hub.gotPotOn", { date: day(myPot!.dueDate) })}</Text>
        </View>
      ) : null}
      {potReceived ? <Text style={styles.small}>{t("hub.keepPaying")}</Text> : null}

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
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
    paddingHorizontal: 20,
    paddingTop: 18,
    gap: 14,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  openBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.action,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 17, color: colors.indigo },
  cycle: { flexDirection: "row", alignItems: "center", gap: 16 },
  side: { flex: 1, minWidth: 0, gap: 4 },
  ringBig: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26, color: colors.indigo },
  ringSmall: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.muted },
  small: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.muted },
  amount: { fontFamily: fonts.display, fontSize: 28, lineHeight: 36, color: colors.indigo },
  amountDue: { color: colors.accent },
  amountGreen: { color: colors.paid },
  splitRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  splitBox: { gap: 8, borderRadius: 16, backgroundColor: colors.mist, paddingHorizontal: 14, paddingVertical: 12 },
  splitLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  splitLabel: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.ink },
  splitAmount: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  splitChange: { alignSelf: "flex-end" },
  splitText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.turnText },
  splitLink: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 19, color: colors.action },
  okRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  status: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 21 },
  statusPaid: { color: colors.paid },
  statusPending: { color: colors.action },
  statusTurn: { color: colors.turnText },
  turnDetail: { color: colors.turnText, marginBottom: 4 },
  potRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    backgroundColor: colors.turnSoft,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  potText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.turnText },
  potBold: { fontFamily: fonts.bodyBold },
  potTextBox: { flex: 1, gap: 2 },
  pay: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  payText: { textAlign: "center", fontFamily: fonts.bodyBold, fontSize: 18, color: colors.white },
  choose: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: colors.action,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  chooseText: { textAlign: "center", fontFamily: fonts.bodyBold, fontSize: 17, color: colors.white },
  actions: {
    flexDirection: "row",
    marginHorizontal: -20,
    marginTop: 0,
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
