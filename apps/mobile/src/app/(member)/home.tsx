import type { GroupSummary, Invitation } from "@novi/shared";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../api/client";
import { listMyGroups, listMyInvitations } from "../../api/groups";
import { ErrorMessage } from "../../components/ErrorMessage";
import { LanguageSwitch } from "../../components/LanguageSwitch";
import { ListenButton } from "../../components/ListenButton";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { TextButton } from "../../components/TextButton";
import { Beads } from "../../components/art/Beads";
import { Glyph } from "../../components/art/Glyph";
import { PagneBand } from "../../components/art/PagneBand";
import { PotJar } from "../../components/art/PotJar";
import { daysUntil, formatDay, formatFcfa } from "../../lib/format";
import { rulesSummary, stateLabel } from "../../lib/rulesText";
import { useSession } from "../../session/SessionProvider";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// Home: the invitations waiting for her answer, then her groups. There is no
// search and no list of other groups: she sees a group only when its
// organiser has invited her number (D40).
//
// Numbers before words (UX direction, 23 Oct): each running group shows its
// pot filling, what she owes or that she paid, a countdown to her turn and her
// on-time streak as beads. Explanations live in Listen, not on the screen.
export default function HomeScreen() {
  const { t } = useTranslation();
  const { member, lock } = useSession();
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

  // Logging out locks Novi on this phone, then opens the PIN screen. Going
  // there directly, instead of letting the app fall back to whatever screen
  // came before home, means she never lands back inside sign-up.
  async function logOut() {
    await lock();
    router.replace("/login");
  }

  const greeting = t("home.greeting", { name: member.displayName });
  const empty = loaded && invitations.length === 0 && groups.length === 0;

  return (
    <Screen>
      <View style={styles.top}>
        <ListenButton text={`${greeting}. ${empty ? t("home.empty") : ""}`} />
      </View>

      <Text style={[type.title, styles.indigo]}>{greeting}</Text>
      <ErrorMessage messageKey={error} />

      {invitations.length > 0 ? (
        <View style={styles.section}>
          <Text style={[type.title, styles.ink]}>{t("home.invitations")}</Text>
          {invitations.map((invitation) => (
            <Pressable
              key={invitation.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/invitations/[id]", params: { id: invitation.id } })}
              style={[styles.card, styles.invitation]}
            >
              <View style={styles.inner}>
                <Text style={[type.body, styles.name]}>{invitation.groupName}</Text>
                <Text style={[type.small, styles.muted]}>
                  {invitation.organiserName} · {rulesSummary(t, invitation.rules)}
                </Text>
                <View style={styles.ctaRow}>
                  <Text style={styles.cta}>{t("home.readAndAnswer")}</Text>
                  <Glyph name="chevron" color={colors.action} />
                </View>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {groups.length > 0 ? (
        <View style={styles.section}>
          <Text style={[type.title, styles.ink]}>{t("home.groups")}</Text>
          {groups.map((group) => (
            <GroupCard key={group.id} group={group} />
          ))}
        </View>
      ) : null}

      {empty ? (
        <View style={styles.section}>
          <Text style={[type.title, styles.ink]}>{t("home.howTitle")}</Text>
          {["home.step1", "home.step2", "home.step3"].map((key, index) => (
            <View key={key} style={styles.step}>
              <Text style={styles.stepNumber}>{index + 1}</Text>
              <Text style={[type.body, styles.stepText]}>{t(key)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.footer}>
        <PrimaryButton label={t("home.create")} onPress={() => router.push("/groups/new")} />
        <TextButton label={t("home.record")} onPress={() => router.push("/record")} />
        <LanguageSwitch />
        {/* Development only: the ID card barcode test (D35). */}
        {__DEV__ ? <TextButton label={t("idScan.title")} onPress={() => router.push("/id-scan-test")} /> : null}
        <TextButton label={t("home.logout")} onPress={() => void logOut()} />
      </View>
    </Screen>
  );
}

// One of her groups. A running group shows this round at a glance; a group
// still being set up shows where it is.
function GroupCard({ group }: { group: GroupSummary }) {
  const { t } = useTranslation();
  const round = group.currentRound;
  const open = () => router.push({ pathname: "/groups/[id]", params: { id: group.id } });

  return (
    <Pressable accessibilityRole="button" onPress={open} style={styles.card}>
      <PagneBand seed={group.id} />
      <View style={styles.inner}>
        <View style={styles.cardTop}>
          <Text style={[type.body, styles.name]}>{group.name}</Text>
          {group.state !== "ACTIVE" ? <Text style={styles.state}>{stateLabel(t, group.state)}</Text> : null}
        </View>

        {round ? (
          <>
            <View style={styles.week}>
              <PotJar
                share={group.size > 0 ? round.paidCount / group.size : 0}
                tone={round.isMyTurn ? "turn" : "paid"}
                label={t("home.potCount", { paid: round.paidCount, size: group.size })}
              />
              <View style={styles.weekText}>
                {round.myStatus === "PAID" ? (
                  <View style={styles.inline}>
                    <Glyph name="check" color={colors.paid} />
                    <Text style={styles.paid}>{t("home.paidShort", { number: round.number })}</Text>
                  </View>
                ) : round.myStatus === "PENDING" ? (
                  <View style={styles.inline}>
                    <Glyph name="clock" color={colors.muted} />
                    <Text style={styles.tag}>{t("home.paying")}</Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.amount}>{formatFcfa(group.amountFcfa)}</Text>
                    <Text style={styles.due}>{t("home.toPay", { date: formatDay(round.dueDate), number: round.number })}</Text>
                  </>
                )}
                <Text style={[type.small, styles.muted]}>{t("home.potCount", { paid: round.paidCount, size: group.size })}</Text>
              </View>
            </View>
            <TurnLine group={group} />
            {round.onTimeStreak > 0 ? (
              <View style={styles.inline}>
                <Beads count={round.onTimeStreak} label={t("home.streak", { count: round.onTimeStreak })} />
                <Text style={styles.tag}>{t("home.streak", { count: round.onTimeStreak })}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Text style={[type.small, styles.muted]}>{rulesSummary(t, group)}</Text>
            {group.myRole === "ORGANISER" ? <Text style={styles.tag}>{t("home.youOrganise")}</Text> : null}
          </>
        )}
      </View>
    </Pressable>
  );
}

// Her turn: now (saffron, the only colour that means "your turn"), counting
// down, or already received.
function TurnLine({ group }: { group: GroupSummary }) {
  const { t } = useTranslation();
  const round = group.currentRound;
  if (!round) return null;

  if (round.isMyTurn) {
    return (
      <Text style={styles.turn}>
        {t("home.yourTurnNow", { pot: formatFcfa(round.potFcfa), date: formatDay(round.dueDate) })}
      </Text>
    );
  }
  const mine = round.myTurn;
  if (!mine) return null;
  if (mine.payoutStatus === "PAID") {
    return (
      <View style={styles.inline}>
        <Glyph name="check" color={colors.paid} />
        <Text style={styles.tag}>{t("home.turnReceived", { number: mine.number })}</Text>
      </View>
    );
  }
  if (mine.payoutStatus === "HELD") {
    return (
      <View style={styles.inline}>
        <Glyph name="lock" color={colors.indigo} />
        <Text style={styles.turnSoon}>{t("home.turnHeld", { number: mine.number })}</Text>
      </View>
    );
  }
  if (mine.payoutStatus !== "NOT_DUE") {
    return (
      <View style={styles.inline}>
        <Glyph name="clock" color={colors.indigo} />
        <Text style={styles.turnSoon}>{t("home.turnSending", { number: mine.number })}</Text>
      </View>
    );
  }
  const days = daysUntil(mine.dueDate);
  const when =
    days <= 0
      ? t("home.today")
      : days === 1
        ? t("home.tomorrow")
        : days < 14
          ? t("home.inDays", { count: days })
          : t("home.inWeeks", { count: Math.round(days / 7) });
  return (
    <View style={styles.inline}>
      <Glyph name="turn" />
      <Text style={styles.turnSoon}>{t("home.turnIn", { when, number: mine.number })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", justifyContent: "flex-end" },
  indigo: { color: colors.indigo },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  section: { gap: 12 },
  card: { borderRadius: 20, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, overflow: "hidden" },
  inner: { gap: 10, padding: 18 },
  invitation: { borderColor: colors.action },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  name: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 19, color: colors.ink },
  state: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.indigo },
  tag: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.muted },
  ctaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  cta: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.action },
  footer: { marginTop: "auto", gap: 12 },
  week: { flexDirection: "row", alignItems: "center", gap: 16 },
  weekText: { flex: 1, gap: 2 },
  amount: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, color: colors.indigo },
  due: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  turn: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: colors.yourTurn,
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.ink,
  },
  turnSoon: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.indigo },
  paid: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.paid },
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
});
