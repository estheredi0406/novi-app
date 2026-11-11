import type { GroupDetail, RoundDetail, RoundSummary } from "@novi/shared";
import { type Href, router } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../api/client";
import { callGroup } from "../../api/groups";
import { answerReceipt, extendCover, getRound } from "../../api/money";
import { openCall } from "../../lib/openCall";
import { daysUntil, formatFcfa, shortDay } from "../../lib/format";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";
import { NextCycleCard } from "../NextCycleCard";
import { PrimaryButton } from "../PrimaryButton";
import { CowrieMark } from "../BottomBar";
import { ErrorMessage } from "../ErrorMessage";
import { LineIcon, type LineIconName } from "../LineIcon";
import { WaxCard } from "../WaxCard";
import { MemberFaces } from "./MemberFaces";
import { SkipSheet } from "./SkipSheet";

// The "Cotisation" tab (approved design F1, restyled as board E5, D92): this
// round with every member as a face in turn order, who receives the pot,
// her own turn, the Payer button with its cowrie, then the group's own
// actions (call, swap a turn, an advance). Only amounts, dates, names and
// buttons: the explanations are behind "?" and Listen.
export function CotisationTab({
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
  const [answering, setAnswering] = useState(false);
  const [detail, setDetail] = useState<RoundDetail | null>(null);
  const current = rounds.find((r) => r.isCurrent);
  // D83: once this round's pot has been paid out, the tab moves on to the
  // next round (its date, who receives it), and she may pay it ahead if she
  // paid this one. The finished round stays as one line above it.
  const next = current ? rounds.find((r) => r.number === current.number + 1) : undefined;
  const finished = current?.payoutStatus === "PAID" && next ? current : undefined;
  const focus = finished ? next : current;

  useEffect(() => {
    if (!focus) return;
    getRound(group.id, focus.number).then(setDetail, () => setDetail(null));
  }, [group.id, focus]);

  const openRound = (number: number) =>
    router.push({ pathname: "/groups/[id]/rounds/[number]", params: { id: group.id, number: String(number) } });
  // Round n's pot goes to the member whose payout position is n.
  const receiver = (number: number) => group.seats.find((s) => s.payoutPosition === number);
  const mySeat = group.seats.find((s) => s.memberId === memberId);
  const myRound = mySeat?.payoutPosition ? rounds.find((r) => r.number === mySeat.payoutPosition) : undefined;

  // D63: her pot reached her wallet; she says whether the money arrived.
  const toConfirm = rounds.find(
    (r) => r.payoutStatus === "PAID" && r.receipt === null && r.payoutId && receiver(r.number)?.memberId === memberId,
  );
  async function answer(received: boolean) {
    if (!toConfirm?.payoutId) return;
    setAnswering(true);
    try {
      await answerReceipt(toConfirm.payoutId, received);
    } finally {
      setAnswering(false);
      onChanged();
    }
  }

  // D104: a round the group's advances paid for her, not repaid yet: she
  // repays it by paying that round, before its deadline.
  const myCover = rounds.find(
    (r) => r.myCover && !r.myCover.repaid && r.myStatus !== "PAID" && r.myStatus !== "PENDING",
  );
  const [skipping, setSkipping] = useState(false);
  const isOrganiser = group.myRole === "ORGANISER";
  // D104: the organiser sees who owes a covered share this round and can give
  // her more time, once.
  const owing = isOrganiser
    ? (detail?.payments ?? []).filter((p) => p.coveredByReserve && !p.coverRepaid && p.memberId !== memberId)
    : [];
  const [extended, setExtended] = useState<Record<string, string>>({});
  async function giveTime(member: string) {
    try {
      const { dueBy } = await extendCover(group.id, member);
      setExtended((e) => ({ ...e, [member]: dueBy }));
    } catch (err) {
      setCallError(errorKey(err));
    }
  }

  const unpaid = (r: RoundSummary) => r.myStatus === "UNPAID" || r.myStatus === "FAILED";
  // Ahead of time only after paying the round before it (the API's rule too).
  const canPay = focus ? unpaid(focus) && (focus === current || current?.myStatus === "PAID") : false;
  const days = myRound ? daysUntil(myRound.dueDate) : 0;
  const [calling, setCalling] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

  // "Appeler le groupe": joins the open call or starts one (D76, D85).
  async function call() {
    setCalling(true);
    setCallError(null);
    try {
      const { url } = await callGroup(group.id);
      await openCall(url, group.name);
    } catch (err) {
      setCallError(errorKey(err));
    } finally {
      setCalling(false);
    }
  }

  return (
    <View style={styles.wrap}>
      {group.state === "COMPLETED" ? <NextCycleCard group={group} onChanged={onChanged} /> : null}

      {myCover ? (
        <WaxCard style={[styles.card, styles.soft]}>
          <Text style={styles.cardTitle}>
            {t("groupView.youOweCover", {
              date: myCover.myCover?.dueBy ? shortDay(myCover.myCover.dueBy, lang) : "",
              amount: formatFcfa(myCover.amountFcfa).replace(" FCFA", " F"),
            })}
          </Text>
          <PrimaryButton pay label={t("groupView.payCover")} onPress={() => openRound(myCover.number)} />
        </WaxCard>
      ) : null}

      {toConfirm ? (
        <WaxCard style={[styles.card, styles.soft]}>
          <Text style={styles.cardTitle}>
            {t("groupView.receiptTitle", { amount: formatFcfa(toConfirm.collectedFcfa), number: toConfirm.number })}
          </Text>
          <PrimaryButton label={t("groupView.receiptYes")} disabled={answering} onPress={() => void answer(true)} />
          <Pressable
            accessibilityRole="button"
            disabled={answering}
            onPress={() => void answer(false)}
            style={styles.second}
          >
            <Text style={styles.secondText}>{t("groupView.receiptNo")}</Text>
          </Pressable>
        </WaxCard>
      ) : null}

      {finished ? (
        <View style={styles.done}>
          <Text style={styles.doneText}>
            ✓ {t("groupView.roundDone", { number: finished.number })} ·{" "}
            {t("groupView.paidTo", {
              name:
                receiver(finished.number)?.memberId === memberId
                  ? t("groupView.you")
                  : (receiver(finished.number)?.displayName ?? finished.beneficiaryName),
            })}
          </Text>
        </View>
      ) : null}

      {focus ? (
        <WaxCard style={styles.card}>
          <View style={styles.headRow}>
            <Text style={styles.roundTitle}>
              {finished ? `${t("groupView.nextRound")} · ` : ""}
              {t("groupView.roundOf", { number: focus.number, total: rounds.length })} · {shortDay(focus.dueDate, lang)}
            </Text>
            <Text style={styles.count}>{t("hub.paidCount", { paid: focus.paidCount, size: focus.size })}</Text>
          </View>
          {detail ? (
            <>
              <Text style={styles.hint}>{t("hub.inTurnOrder")}</Text>
              <MemberFaces payments={detail.payments} memberId={memberId} receiverIndex={focus.number - 1} />
            </>
          ) : null}
          <View style={styles.pills}>
            <Text style={[styles.pill, styles.pillTurn]}>
              {receiver(focus.number)?.memberId === memberId
                ? t("hub.youReceive", { pot: formatFcfa(focus.potFcfa).replace(" FCFA", " F") })
                : t("hub.receives", {
                    name: receiver(focus.number)?.displayName ?? focus.beneficiaryName,
                    pot: formatFcfa(focus.potFcfa).replace(" FCFA", " F"),
                  })}
            </Text>
            {myRound && myRound.number !== focus.number ? (
              <Text style={[styles.pill, styles.pillMine]}>
                {myRound.payoutStatus === "PAID"
                  ? `✓ ${t("groupView.received")} · ${t("hub.yourSeat", { number: myRound.number })}`
                  : t("hub.yourSeatDate", {
                      number: myRound.number,
                      date: shortDay(myRound.dueDate, lang),
                      when: days <= 0 ? t("home.today") : t("home.inDays", { count: days }),
                    })}
              </Text>
            ) : null}
          </View>
          {canPay ? (
            <Pressable accessibilityRole="button" onPress={() => openRound(focus.number)} style={styles.pay}>
              <CowrieMark size={30} />
              <Text style={styles.payText}>
                {focus === current
                  ? t("hub.pay", {
                      amount: formatFcfa(group.rules.amountFcfa + focus.advanceFcfa).replace(" FCFA", " F"),
                    })
                  : t("groupView.payAhead")}
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.status, focus.myStatus === "PAID" && styles.paid]}>
              {focus.myStatus === "PAID"
                ? `✓ ${t("groupView.youPaidShort")}`
                : focus.myStatus === "PENDING"
                  ? t("groupView.onItsWay")
                  : t("groupView.payCurrentFirst")}
            </Text>
          )}
          {focus.canSkip ? (
            <Pressable accessibilityRole="button" onPress={() => setSkipping(true)} style={styles.second}>
              <Text style={styles.secondText}>{t("skip.button")}</Text>
            </Pressable>
          ) : null}
          {owing.map((p) => (
            <View key={p.memberId} style={styles.owingRow}>
              <Text style={styles.owingText}>
                {t("groupView.owes", {
                  name: p.displayName.split(" ")[0],
                  amount: formatFcfa(group.rules.amountFcfa).replace(" FCFA", " F"),
                })}
              </Text>
              {extended[p.memberId] ? (
                <Text style={styles.owingDone}>
                  {t("groupView.extended", { date: shortDay(extended[p.memberId] as string, lang) })}
                </Text>
              ) : (
                <Pressable accessibilityRole="button" onPress={() => void giveTime(p.memberId)}>
                  <Text style={styles.owingLink}>{t("groupView.extend")}</Text>
                </Pressable>
              )}
            </View>
          ))}
        </WaxCard>
      ) : null}

      {focus ? (
        <SkipSheet
          visible={skipping}
          group={group}
          round={focus}
          next={rounds.find((r) => r.number === focus.number + 1)}
          onClose={() => setSkipping(false)}
          onDone={() => {
            setSkipping(false);
            onChanged();
          }}
        />
      ) : null}

      {group.state === "ACTIVE" ? (
        <View style={styles.section}>
          <Text style={styles.title}>{t("hub.forGroup")}</Text>
          <View style={styles.tiles}>
            <Tile icon="phone" label={t("hub.callGroup")} onPress={() => void call()} busy={calling} />
            <Tile
              icon="swap"
              label={t("hub.swap")}
              onPress={() => router.push({ pathname: "/groups/[id]/swap", params: { id: group.id } } as unknown as Href)}
            />
          </View>
          <ErrorMessage messageKey={callError} />
        </View>
      ) : null}
    </View>
  );
}

function Tile({
  icon,
  label,
  onPress,
  busy,
}: {
  icon: LineIconName;
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={busy} style={[styles.tile, busy && styles.busy]}>
      <View style={styles.tileIcon}>
        <LineIcon name={icon} />
      </View>
      <Text style={styles.tileText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 24 },
  card: { padding: 20, gap: 16 },
  done: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, backgroundColor: colors.paidSoft },
  doneText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.paid },
  soft: { backgroundColor: colors.mist },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 22, color: colors.indigo },
  kicker: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.lagoon,
  },
  amount: { fontFamily: fonts.display, fontSize: 32, lineHeight: 40, color: colors.indigo },
  status: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.muted },
  section: { gap: 12 },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.indigo },
  list: { borderRadius: 16, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  line: { borderBottomWidth: 1, borderBottomColor: colors.line },
  name: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  tag: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.muted },
  paid: { color: colors.paid },
  covered: { color: colors.turnText },
  tiles: { flexDirection: "row", gap: 12 },
  tile: {
    flex: 1,
    alignItems: "center",
    gap: 10,
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 6,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  busy: { opacity: 0.5 },
  tileIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.mist,
    alignItems: "center",
    justifyContent: "center",
  },
  tileText: { fontFamily: fonts.bodyBold, fontSize: 13, lineHeight: 17, color: colors.ink, textAlign: "center" },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  roundTitle: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  count: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: -6 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: "hidden",
  },
  pillTurn: { backgroundColor: colors.turnSoft, color: colors.turnText },
  pillMine: { backgroundColor: colors.mist, color: colors.lagoon },
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
  second: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  secondText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.indigo },
  owingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  owingText: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  owingLink: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.lagoon },
  owingDone: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
});
