import type { GroupSummary, Invitation } from "@novi/shared";
import { type Href, router, useFocusEffect } from "expo-router";
import type { TFunction } from "i18next";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Rect } from "react-native-svg";
import { errorKey } from "../../api/client";
import { listMyGroups, listMyInvitations } from "../../api/groups";
import { BottomBar } from "../../components/BottomBar";
import { ErrorMessage } from "../../components/ErrorMessage";
import { HomeBand } from "../../components/HomeBand";
import { ListenButton } from "../../components/ListenButton";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { Cowrie } from "../../components/art/Cowrie";
import { CowrieString } from "../../components/art/CowrieString";
import { Glyph } from "../../components/art/Glyph";
import { PotJar } from "../../components/art/PotJar";
import { daysUntil, formatDay, formatFcfa } from "../../lib/format";
import { rulesSummary, stateLabel } from "../../lib/rulesText";
import { useSession } from "../../session/SessionProvider";
import { colors } from "../../theme/colors";
import { UnreadDot } from "../../components/ChatEntry";
import { fonts, type } from "../../theme/typography";

// Home, as on the approved "Home: wax" board (25 Oct). The wax band carries
// the date, her name and this week's card: what she owes, by when, the pot
// filling with coins and who has paid. Below: the pay button, then her
// groups as short rows. She sees a group only when its organiser has
// invited her number (D40).
export default function HomeScreen() {
  const { t, i18n } = useTranslation();
  const { member } = useSession();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reloads every time home comes back into view, for example after she
  // answers an invitation or creates a group.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        try {
          const [nextInvitations, nextGroups] = await Promise.all([listMyInvitations(), listMyGroups()]);
          if (!active) return;
          setInvitations(nextInvitations);
          setGroups(nextGroups);
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

  if (!member) return null;

  const empty = loaded && invitations.length === 0 && groups.length === 0;
  // Today's date in the same language as the texts: Ewe screens still show
  // French texts (until a native speaker reviews them), so the date follows.
  const dateLanguage = i18n.language === "ee" ? "fr" : i18n.language;
  const today = new Date().toLocaleDateString(dateLanguage, { weekday: "long", day: "numeric", month: "long" });
  // This week's card: a running group where she still owes, otherwise the
  // first running group.
  const running = groups.filter((g) => g.currentRound);
  const owing = running.find((g) => g.currentRound?.myStatus === "UNPAID" || g.currentRound?.myStatus === "FAILED");
  const hero = owing ?? running[0];
  const heroOwes = hero === owing && owing !== undefined;
  const openRound = (group: GroupSummary) =>
    group.currentRound
      ? router.push({
          pathname: "/groups/[id]/rounds/[number]",
          params: { id: group.id, number: String(group.currentRound.number) },
        })
      : undefined;

  return (
    <Screen
      bar={<BottomBar active="home" />}
      top={
        <HomeBand>
          <View style={styles.header}>
            <Text style={styles.wordmark}>Novi</Text>
            <ListenButton
              text={`${t("home.greeting", { name: member.displayName })}. ${today}. ${empty ? t("home.empty") : ""}`}
            />
          </View>
          {/* The pot as the band's centre piece: a picture of what a tontine
              builds. Decoration only, so screen readers skip it. */}
          <View style={styles.potAlone} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <PotJar paid={3} size={110} label="" />
          </View>
        </HomeBand>
      }
    >
      <View>
        <Text style={styles.date}>{today}</Text>
        <Text style={styles.name}>{t("home.greeting", { name: member.displayName })}</Text>
      </View>
      <CowrieString />
      {/* This week's card sits under the band, so the print stays whole. */}
      {hero ? <WeekCard group={hero} /> : null}

      <ErrorMessage messageKey={error} />

      {hero && heroOwes ? (
        <PrimaryButton label={t("home.pay", { amount: formatFcfa(hero.amountFcfa) })} onPress={() => openRound(hero)} />
      ) : null}

      {invitations.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("home.invitations")}</Text>
          {invitations.map((invitation) => (
            <Pressable
              key={invitation.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/invitations/[id]", params: { id: invitation.id } })}
              style={[styles.row, styles.invitation]}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowName}>{invitation.groupName}</Text>
                <Text style={styles.rowSub}>
                  {invitation.organiserName} · {rulesSummary(t, invitation.rules)}
                </Text>
                <Text style={styles.cta}>{t("home.readAndAnswer")}</Text>
              </View>
              <Glyph name="chevron" color={colors.indigo} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {groups.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{t("home.groups")}</Text>
            <Pressable accessibilityRole="link" onPress={() => router.push("/groups/new")} hitSlop={12}>
              <Text style={styles.link}>{t("home.newGroup")}</Text>
            </Pressable>
          </View>
          {groups.map((group) => (
            <GroupRow key={group.id} group={group} />
          ))}
        </View>
      ) : null}


      {empty ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("home.howTitle")}</Text>
          {["home.step1", "home.step2", "home.step3"].map((key, index) => (
            <View key={key} style={styles.step}>
              <Text style={styles.stepNumber}>{index + 1}</Text>
              <Text style={[type.body, styles.stepText]}>{t(key)}</Text>
            </View>
          ))}
          <View style={styles.footer}>
            <PrimaryButton label={t("home.create")} onPress={() => router.push("/groups/new")} />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

// This week in one running group: the amount and date she owes (or that she
// paid), the pot with one coin per member who paid, and a dot per member.
function WeekCard({ group }: { group: GroupSummary }) {
  const { t } = useTranslation();
  const round = group.currentRound;
  if (!round) return null;
  const owes = round.myStatus === "UNPAID" || round.myStatus === "FAILED";

  return (
    <View style={styles.weekWrap}>
      <View style={styles.weekShadow} />
      <View style={styles.week}>
        <View style={styles.weekTop}>
          <View style={styles.weekText}>
            <Text style={styles.eyebrow}>{t("home.thisWeek", { number: round.number })}</Text>
            {owes ? (
              <>
                <Text style={styles.amount}>{formatFcfa(group.amountFcfa).replace(" FCFA", "")}</Text>
                <Text style={styles.by}>{t("home.byDate", { date: formatDay(round.dueDate) })}</Text>
                <Text style={styles.when}>{whenText(t, daysUntil(round.dueDate))}</Text>
              </>
            ) : round.myStatus === "PENDING" ? (
              <Text style={styles.status}>{t("home.paying")}</Text>
            ) : (
              <View style={styles.inline}>
                <Glyph name="check" color={colors.paid} />
                <Text style={[styles.status, styles.paid]}>{t("home.paidThisWeek")}</Text>
              </View>
            )}
            {round.isMyTurn ? (
              <Text style={styles.turn}>
                {t("home.yourTurnNow", { pot: formatFcfa(round.potFcfa), date: formatDay(round.dueDate) })}
              </Text>
            ) : null}
          </View>
          <PotJar paid={round.paidCount} label={t("home.potCount", { paid: round.paidCount, size: group.size })} />
        </View>
        <View style={styles.dots}>
          {Array.from({ length: group.size }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: one dot per seat, fixed order
            <View key={i} style={[styles.dot, i < round.paidCount && styles.dotPaid]} />
          ))}
          <Text style={styles.dotsText} numberOfLines={1}>
            {t("home.potLine", { paid: round.paidCount, size: group.size, group: group.name })}
          </Text>
        </View>
      </View>
    </View>
  );
}

// One group as a short row: a cowrie tile, its name, and her turn or where the
// group is in its set-up.
function GroupRow({ group }: { group: GroupSummary }) {
  const { t } = useTranslation();
  const round = group.currentRound;
  const mine = round?.myTurn;

  let line: string;
  if (round?.isMyTurn) {
    line = t("home.yourTurnNow", { pot: formatFcfa(round.potFcfa), date: formatDay(round.dueDate) });
  } else if (round && mine?.payoutStatus === "PAID") {
    line = t("home.turnReceived", { number: mine.number });
  } else if (round && mine) {
    line = t("home.myTurnShort", { when: whenText(t, daysUntil(mine.dueDate)) });
  } else {
    line = `${stateLabel(t, group.state)} · ${rulesSummary(t, group)}`;
  }
  const streak = round && round.onTimeStreak > 0 ? ` · ${t("home.streak", { count: round.onTimeStreak })}` : "";

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: "/groups/[id]", params: { id: group.id } })}
      style={styles.row}
    >
      <Svg width={56} height={56} viewBox="0 0 56 56">
        <Rect width={56} height={56} rx={16} fill={colors.mist} />
        <Cowrie cx={24} cy={26} rx={12} ry={18} rotate={40} strokeWidth={1.4} />
        <G fill={colors.indigo}>
          <Circle cx={40} cy={42} r={2.4} />
          <Circle cx={46} cy={38} r={2.4} />
          <Circle cx={46} cy={46} r={2.4} />
        </G>
      </Svg>
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {group.name}
        </Text>
        <Text style={styles.rowSub}>
          {line}
          {streak}
        </Text>
        {group.myRole === "ORGANISER" && !round ? <Text style={styles.rowSub}>{t("home.youOrganise")}</Text> : null}
      </View>
      <UnreadDot count={group.unreadMessages} />
      <Glyph name="chevron" color={colors.indigo} />
    </Pressable>
  );
}

// "today", "tomorrow", "in 6 days", "in 3 weeks".
function whenText(t: TFunction, days: number): string {
  if (days <= 0) return t("home.today");
  if (days === 1) return t("home.tomorrow");
  if (days < 14) return t("home.inDays", { count: days });
  return t("home.inWeeks", { count: Math.round(days / 7) });
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  wordmark: { fontFamily: fonts.display, fontSize: 26, color: colors.indigo },
  date: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.muted,
  },
  name: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: colors.indigo },
  potAlone: { alignItems: "center" },
  weekWrap: { paddingRight: 4, paddingBottom: 4 },
  weekShadow: {
    position: "absolute",
    top: 4,
    left: 4,
    right: 0,
    bottom: 0,
    borderRadius: 26,
    backgroundColor: colors.indigo,
  },
  week: {
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.shell,
    padding: 18,
    gap: 12,
  },
  weekTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  weekText: { flex: 1, gap: 2 },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.accent,
  },
  amount: { fontFamily: fonts.display, fontSize: 46, lineHeight: 50, color: colors.indigo },
  by: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.indigo },
  when: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.muted },
  status: { fontFamily: fonts.bodyBold, fontSize: 20, lineHeight: 26, color: colors.indigo },
  paid: { color: colors.paid },
  turn: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: colors.yourTurn,
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
  },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  dots: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.indigo },
  dotPaid: { backgroundColor: colors.paid },
  dotsText: { flex: 1, marginLeft: 4, fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.muted },
  section: { gap: 12 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  sectionTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.indigo },
  link: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.indigo },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
  },
  invitation: { borderColor: colors.accent, borderWidth: 2 },
  rowText: { flex: 1, gap: 3, minWidth: 0 },
  rowName: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  rowSub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  cta: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.accent },
  step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: "hidden",
    textAlign: "center",
    lineHeight: 28,
    backgroundColor: colors.mist,
    fontFamily: fonts.bodyBold,
    color: colors.indigo,
  },
  stepText: { flex: 1, color: colors.ink },
  footer: { marginTop: 8 },
});
