import type { GroupDetail, RoundDetail, RoundSummary } from "@novi/shared";
import { router } from "expo-router";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Ellipse } from "react-native-svg";
import { getRound } from "../api/money";
import { daysUntil, formatDay, formatFcfa } from "../lib/format";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { PrimaryButton } from "./PrimaryButton";
import { Glyph } from "./art/Glyph";

// A running group as a member sees it (the approved "Group: a member's view"
// board): what she still owes this round, who has paid, and who receives
// the pot each round.
export function GroupRoundView({
  group,
  rounds,
  memberId,
}: {
  group: GroupDetail;
  rounds: RoundSummary[];
  memberId: string;
}) {
  const { t } = useTranslation();
  const current = rounds.find((r) => r.isCurrent);
  const [detail, setDetail] = useState<RoundDetail | null>(null);

  useEffect(() => {
    if (!current) return;
    getRound(group.id, current.number).then(setDetail, () => setDetail(null));
  }, [group.id, current]);

  const openRound = (number: number) =>
    router.push({ pathname: "/groups/[id]/rounds/[number]", params: { id: group.id, number: String(number) } });
  // Round n's pot goes to the member whose payout position is n.
  const receiver = (number: number) => group.seats.find((s) => s.payoutPosition === number);

  return (
    <View style={styles.wrap}>
      {current ? (
        <OweCard t={t} round={current} amount={group.rules.amountFcfa} onPay={() => openRound(current.number)} />
      ) : null}

      {current && detail ? (
        <View style={styles.section}>
          <View style={styles.head}>
            <Text style={styles.title}>{t("groupView.whoPaid", { number: current.number })}</Text>
            <Text style={styles.count}>{t("groupView.count", { paid: current.paidCount, size: current.size })}</Text>
          </View>
          <View style={styles.list}>
            {detail.payments.map((p, i) => {
              const paid = p.status === "PAID";
              const me = p.memberId === memberId;
              return (
                <View key={p.memberId} style={[styles.payRow, i < detail.payments.length - 1 && styles.line]}>
                  <Coins filled={paid} />
                  <View style={styles.payText}>
                    <Text style={styles.payName}>{me ? t("groupView.you") : p.displayName}</Text>
                    <Text style={styles.paySub}>
                      {paid && p.paidAt ? t("groupView.paidAt", { date: formatDay(p.paidAt) }) : t("groupView.notYet")}
                    </Text>
                  </View>
                  <Text style={[styles.tag, paid ? styles.tagPaid : me ? styles.tagMine : null]}>
                    {paid
                      ? t("groupView.paid")
                      : p.status === "PENDING"
                        ? t("groupView.onItsWay")
                        : me
                          ? t("groupView.toPay")
                          : t("groupView.waiting")}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.title}>{t("groupView.whoReceives")}</Text>
        <View style={styles.medals}>
          {rounds.map((r) => {
            const seat = receiver(r.number);
            const mine = seat?.memberId === memberId;
            const received = r.payoutStatus === "PAID";
            return (
              <View key={r.number} style={[styles.medal, r.isCurrent && styles.medalNow, mine && styles.medalMine]}>
                <Text style={[styles.medalRound, mine && styles.onAccent]}>
                  {r.isCurrent
                    ? t("groupView.roundNow", { number: r.number })
                    : t("groupView.round", { number: r.number })}
                </Text>
                <Text style={[styles.medalName, mine && styles.onAccent]} numberOfLines={1}>
                  {mine ? t("groupView.you") : (seat?.displayName ?? r.beneficiaryName)}
                </Text>
                {received ? (
                  <View style={styles.inline}>
                    <Glyph name="check" color={mine ? colors.white : colors.paid} />
                    <Text style={[styles.medalDate, styles.received, mine && styles.onAccent]}>
                      {t("groupView.received")}
                    </Text>
                  </View>
                ) : (
                  <Text style={[styles.medalDate, mine && styles.onAccent]}>{formatDay(r.dueDate).slice(0, 5)}</Text>
                )}
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function OweCard({
  t,
  round,
  amount,
  onPay,
}: {
  t: TFunction;
  round: RoundSummary;
  amount: number;
  onPay: () => void;
}) {
  const owes = round.myStatus === "UNPAID" || round.myStatus === "FAILED";
  const days = daysUntil(round.dueDate);
  const when =
    days <= 0
      ? t("home.today")
      : days === 1
        ? t("home.tomorrow")
        : days < 14
          ? t("home.inDays", { count: days })
          : t("home.inWeeks", { count: Math.round(days / 7) });

  return (
    <View style={styles.cardWrap}>
      <View style={styles.cardShadow} />
      <View style={styles.card}>
        <View style={styles.inline}>
          <View style={[styles.bullet, !owes && styles.bulletPaid]} />
          <Text style={styles.cardTitle}>{owes ? t("groupView.youOwe") : t("groupView.youPaid")}</Text>
        </View>
        {owes ? (
          <>
            <View style={styles.amountRow}>
              <Text style={styles.amount}>{formatFcfa(amount)}</Text>
              <Text style={styles.by}>{t("groupView.by", { date: formatDay(round.dueDate).slice(0, 5), when })}</Text>
            </View>
            <PrimaryButton label={t("groupView.payNow")} onPress={onPay} />
          </>
        ) : null}
      </View>
    </View>
  );
}

// A paid member: a small stack of coins. Not yet: a dotted outline.
function Coins({ filled }: { filled: boolean }) {
  return (
    <Svg width={34} height={34} viewBox="0 0 34 34">
      {filled ? (
        <>
          <Ellipse cx={17} cy={22} rx={12} ry={5} fill={colors.goldDeep} stroke={colors.indigo} strokeWidth={1.3} />
          <Ellipse cx={17} cy={17} rx={12} ry={5} fill={colors.gold} stroke={colors.indigo} strokeWidth={1.3} />
          <Ellipse cx={17} cy={12} rx={12} ry={5} fill={colors.goldDeep} stroke={colors.indigo} strokeWidth={1.3} />
        </>
      ) : (
        <Ellipse
          cx={17}
          cy={17}
          rx={12}
          ry={5}
          fill="none"
          stroke={colors.crackle}
          strokeWidth={1.4}
          strokeDasharray="3 3"
        />
      )}
    </Svg>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 20 },
  cardWrap: { paddingRight: 3, paddingBottom: 3 },
  cardShadow: {
    position: "absolute",
    top: 3,
    left: 3,
    right: 0,
    bottom: 0,
    borderRadius: 22,
    backgroundColor: colors.indigo,
  },
  card: {
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
    padding: 16,
    gap: 12,
  },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  bullet: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.accent,
    borderWidth: 1.2,
    borderColor: colors.indigo,
  },
  bulletPaid: { backgroundColor: colors.paid },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.indigo },
  amountRow: { flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  amount: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, color: colors.indigo },
  by: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.muted },
  section: { gap: 10 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  title: { fontFamily: fonts.display, fontSize: 18, color: colors.indigo },
  count: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.muted },
  list: {
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  payRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  line: { borderBottomWidth: 1, borderBottomColor: colors.line },
  payText: { flex: 1 },
  payName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  paySub: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  tag: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.muted },
  tagPaid: { fontFamily: fonts.bodyBold, color: colors.paid },
  tagMine: { fontFamily: fonts.bodyBold, color: colors.accent },
  medals: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  medal: {
    flexBasis: "30%",
    flexGrow: 1,
    alignItems: "center",
    gap: 2,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
  },
  medalNow: { backgroundColor: colors.mist, borderWidth: 1.5 },
  medalMine: { backgroundColor: colors.accent, borderWidth: 1.5 },
  medalRound: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  medalName: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  medalDate: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.indigo },
  received: { color: colors.paid },
  onAccent: { color: colors.white },
});
