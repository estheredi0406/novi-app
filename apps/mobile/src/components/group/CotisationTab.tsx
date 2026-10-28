import type { GroupDetail, RoundDetail, RoundSummary } from "@novi/shared";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { answerReceipt, getRound } from "../../api/money";
import { daysUntil, formatFcfa, shortDay } from "../../lib/format";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";
import { NextCycleCard } from "../NextCycleCard";
import { PrimaryButton } from "../PrimaryButton";
import { WaxCard } from "../WaxCard";

// The "Cotisation" tab (approved design F1): what she owes this round and
// the button to pay, who has paid, who receives on the due day, and when her
// own turn comes. Only amounts, dates, names and buttons: the explanations
// are behind "?" and Listen.
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

  useEffect(() => {
    if (!current) return;
    getRound(group.id, current.number).then(setDetail, () => setDetail(null));
  }, [group.id, current]);

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

  // D68: a round the caisse paid for her, which she has not repaid yet.
  const myCover = rounds.find((r) => r.coveredCount > 0 && r.myStatus !== "PAID" && r.myStatus !== "PENDING");

  const owes = current ? current.myStatus === "UNPAID" || current.myStatus === "FAILED" : false;
  const days = myRound ? daysUntil(myRound.dueDate) : 0;

  return (
    <View style={styles.wrap}>
      {group.state === "COMPLETED" ? <NextCycleCard group={group} onChanged={onChanged} /> : null}

      {myCover ? (
        <WaxCard style={[styles.card, styles.soft]}>
          <Text style={styles.cardTitle}>
            {t("groupView.youOweCover", {
              number: myCover.number,
              amount: formatFcfa(myCover.potFcfa / group.rules.size),
            })}
          </Text>
          <PrimaryButton label={t("groupView.payCover")} onPress={() => openRound(myCover.number)} />
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

      {current ? (
        <WaxCard style={styles.card}>
          <Text style={styles.kicker}>
            {t("groupView.roundOf", { number: current.number, total: rounds.length })} ·{" "}
            {shortDay(current.dueDate, lang)}
          </Text>
          <Text style={styles.amount}>{formatFcfa(group.rules.amountFcfa)}</Text>
          {owes ? (
            <PrimaryButton label={t("groupView.pay")} onPress={() => openRound(current.number)} />
          ) : (
            <Text style={[styles.status, current.myStatus === "PAID" && styles.paid]}>
              {current.myStatus === "PAID" ? `✓ ${t("groupView.youPaidShort")}` : t("groupView.onItsWay")}
            </Text>
          )}
        </WaxCard>
      ) : null}

      {current && detail ? (
        <View style={styles.section}>
          <Text style={styles.title}>{t("groupView.paidOf", { paid: current.paidCount, size: current.size })}</Text>
          <View style={styles.list}>
            {detail.payments.map((p, i) => {
              const paid = p.status === "PAID";
              const covered = p.coveredByReserve && !paid;
              const me = p.memberId === memberId;
              return (
                <View key={p.memberId} style={[styles.row, i < detail.payments.length - 1 && styles.line]}>
                  <Text style={styles.name}>{me ? t("groupView.you") : p.displayName}</Text>
                  <Text style={[styles.tag, paid && styles.paid, covered && styles.covered]}>
                    {paid
                      ? `✓ ${t("groupView.paid")}`
                      : covered
                        ? t("groupView.coveredTag")
                        : p.status === "PENDING"
                          ? t("groupView.onItsWay")
                          : me
                            ? t("groupView.toPay")
                            : t("groupView.notYet")}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {current || myRound ? (
        <View style={styles.tiles}>
          {current ? (
            <View style={[styles.tile, styles.tileSoft]}>
              <Text style={styles.tileLabel}>{t("groupView.receivesOn", { day: shortDay(current.dueDate, lang) })}</Text>
              <Text style={styles.tileMain} numberOfLines={1}>
                {receiver(current.number)?.memberId === memberId
                  ? t("groupView.you")
                  : (receiver(current.number)?.displayName ?? current.beneficiaryName)}
              </Text>
              <Text style={styles.tileSub}>{formatFcfa(current.potFcfa)}</Text>
            </View>
          ) : null}
          {myRound ? (
            <View style={[styles.tile, styles.tileMine]}>
              <Text style={[styles.tileLabel, styles.onDarkSoft]}>{t("groupView.yourTurn")}</Text>
              <Text style={[styles.tileMain, styles.onDark]}>{shortDay(myRound.dueDate, lang)}</Text>
              <Text style={[styles.tileSub, styles.onDarkSoft]}>
                {myRound.payoutStatus === "PAID"
                  ? `✓ ${t("groupView.received")}`
                  : days <= 0
                    ? t("home.today")
                    : t("home.inDays", { count: days })}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 18 },
  card: { padding: 18, gap: 10 },
  soft: { backgroundColor: colors.mist },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 22, color: colors.indigo },
  kicker: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.accent,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  amount: { fontFamily: fonts.display, fontSize: 32, lineHeight: 40, color: colors.indigo },
  status: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.muted },
  section: { gap: 8 },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.indigo },
  list: { borderRadius: 16, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  line: { borderBottomWidth: 1, borderBottomColor: colors.line },
  name: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
  tag: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.muted },
  paid: { color: colors.paid },
  covered: { color: colors.teal },
  tiles: { flexDirection: "row", gap: 12 },
  tile: { flex: 1, padding: 14, borderRadius: 16, gap: 2 },
  tileSoft: { backgroundColor: colors.mist },
  tileMine: { backgroundColor: colors.indigo },
  tileLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  tileMain: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
  tileSub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  onDark: { color: colors.white },
  onDarkSoft: { color: colors.mist },
  second: {
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  secondText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.indigo },
});
