import type { GroupSummary, Statement } from "@novi/shared";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../../api/client";
import { listMyGroups } from "../../../api/groups";
import { getStatement } from "../../../api/news";
import { SeatRing } from "../../../components/art/SeatRing";
import { BottomBar } from "../../../components/BottomBar";
import { ErrorMessage } from "../../../components/ErrorMessage";
import { LineIcon } from "../../../components/LineIcon";
import { Screen } from "../../../components/Screen";
import { formatFcfa, shortDay } from "../../../lib/format";
import { rulesSummary, stateLabel } from "../../../lib/rulesText";
import { colors } from "../../../theme/colors";
import { fonts } from "../../../theme/typography";

// Mes groupes (D92, board E4): each tontine shown like an account in a bank
// app, with its ring, its rules and where it stands for her. On top, what she
// paid this month (from her statement) and her next pot.
const MAX_GROUPS = 3; // D26

export default function MyGroupsScreen() {
  const { t, i18n } = useTranslation();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        try {
          const [g, s] = await Promise.all([listMyGroups(), getStatement().catch(() => null)]);
          if (!active) return;
          setGroups(g);
          setStatement(s);
          setError(null);
        } catch (err) {
          if (active) setError(errorKey(err));
        } finally {
          if (active) setLoaded(true);
        }
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  const locale = i18n.language === "en" ? "en-GB" : "fr-FR";
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const paidThisMonth = (statement?.lines ?? [])
    .filter((l) => l.kind === "PAID" && l.at.slice(0, 7) === thisMonth)
    .reduce((sum, l) => sum + l.amountFcfa, 0);
  const monthName = now.toLocaleDateString(locale, { month: "long", timeZone: "UTC" });

  // Her next pot: the soonest turn not yet received, across her groups.
  const next = groups
    .flatMap((g) =>
      g.currentRound?.myTurn && g.currentRound.myTurn.payoutStatus !== "PAID"
        ? [{ date: g.currentRound.myTurn.dueDate, pot: g.currentRound.potFcfa }]
        : [],
    )
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const live = groups.filter((g) => g.state !== "COMPLETED" && g.state !== "CANCELLED");

  return (
    <Screen bar={<BottomBar active="groups" />}>
      <View style={styles.head}>
        <Text style={styles.title}>{t("myGroups.title")}</Text>
        <Pressable accessibilityRole="button" onPress={() => router.push("/groups/new")} style={styles.newButton}>
          <Text style={styles.newText}>{t("myGroups.new")}</Text>
        </Pressable>
      </View>

      <View style={styles.summary}>
        <View style={[styles.sumBox, styles.sumDark]}>
          <Text style={styles.sumLabelDark}>{t("myGroups.paidIn", { month: monthName })}</Text>
          <Text style={styles.sumValueDark}>{formatFcfa(paidThisMonth).replace(" FCFA", " F")}</Text>
        </View>
        <View style={styles.sumBox}>
          <Text style={styles.sumLabel}>{t("myGroups.nextPot")}</Text>
          {next ? (
            <>
              <Text style={styles.sumValue}>{formatFcfa(next.pot).replace(" FCFA", " F")}</Text>
              <Text style={styles.sumLabel}>{shortDay(next.date, i18n.language)}</Text>
            </>
          ) : (
            <Text style={styles.sumLabel}>{t("myGroups.noPot")}</Text>
          )}
        </View>
      </View>

      <ErrorMessage messageKey={error} />

      {loaded && groups.length === 0 ? <Text style={styles.empty}>{t("myGroups.empty")}</Text> : null}

      {groups.map((g) => (
        <GroupRow key={g.id} group={g} />
      ))}

      {live.length >= MAX_GROUPS ? <Text style={styles.note}>{t("myGroups.limit")}</Text> : null}
    </Screen>
  );
}

function GroupRow({ group }: { group: GroupSummary }) {
  const { t, i18n } = useTranslation();
  const round = group.currentRound;
  const owes = round?.myStatus === "UNPAID" || round?.myStatus === "FAILED";

  let status: { text: string; color: string };
  if (!round) status = { text: stateLabel(t, group.state), color: colors.lagoon };
  else if (round.isMyTurn) status = { text: t("myGroups.yourTurn"), color: "#8A5A00" };
  else if (owes) status = { text: t("myGroups.toPayBefore", { date: shortDay(round.dueDate, i18n.language) }), color: colors.accent };
  else if (round.myStatus === "PENDING") status = { text: t("myGroups.paying"), color: colors.lagoon };
  else status = { text: t("myGroups.paidRound"), color: colors.paid };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: "/groups/[id]", params: { id: group.id } })}
      style={styles.row}
    >
      <SeatRing
        paid={round ? round.paidSeats : Array.from({ length: group.size }, () => false)}
        mine={round?.myTurn ? round.myTurn.number - 1 : null}
        receiver={round ? round.number - 1 : null}
        size={74}
      >
        <Text style={styles.ringText}>
          {round ? round.paidCount : 0}/{group.size}
        </Text>
      </SeatRing>
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={2}>
          {group.name}
        </Text>
        <Text style={styles.rowSub}>{rulesSummary(t, group)}</Text>
        <View style={[styles.pill, { backgroundColor: `${status.color}1F` }]}>
          <Text style={[styles.pillText, { color: status.color }]}>{status.text}</Text>
        </View>
      </View>
      <LineIcon name="chevron" color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontFamily: fonts.bodyBold, fontSize: 26, lineHeight: 32, color: colors.indigo },
  newButton: { backgroundColor: colors.mist, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  newText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.lagoon },
  summary: { flexDirection: "row", gap: 10 },
  sumBox: {
    flex: 1,
    borderRadius: 18,
    padding: 14,
    gap: 2,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  sumDark: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  sumLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  sumLabelDark: { fontFamily: fonts.body, fontSize: 13, color: colors.onDark, opacity: 0.85 },
  sumValue: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.indigo },
  sumValueDark: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.white },
  empty: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.muted },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.muted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  ringText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  rowName: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  rowSub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  pill: { alignSelf: "flex-start", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, marginTop: 4 },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 13 },
});
