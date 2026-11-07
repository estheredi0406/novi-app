import type { GroupSummary, Invitation, NewsItem } from "@novi/shared";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { errorKey } from "../../api/client";
import { listMyGroups, listMyInvitations } from "../../api/groups";
import { listNews } from "../../api/news";
import { BottomBar, CowrieMark } from "../../components/BottomBar";
import { ErrorMessage } from "../../components/ErrorMessage";
import { GroupCard } from "../../components/hub/GroupCard";
import { NewsRow, newsTitle } from "../../components/hub/NewsRow";
import { LaguneBand } from "../../components/LaguneBand";
import { LineIcon, type LineIconName } from "../../components/LineIcon";
import { ListenRound } from "../../components/ListenButton";
import { LoanCard } from "../../components/LoanCard";
import { Screen } from "../../components/Screen";
import { SeatRing } from "../../components/art/SeatRing";
import { cardsInOrder, owes } from "../../lib/hub";
import { rulesSummary, stateLabel } from "../../lib/rulesText";
import { useSession } from "../../session/SessionProvider";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

// Home, direction "Lagune" (D92, boards E1 to E3 and E7), built like the bank
// and mobile money apps traders already use: a blue band with her name, one
// card per running group (swipe between them) with that group's own actions
// on it, then "Pour vous" (things about her, never about one group), then the
// latest news from all her groups. Invitations and groups still being set up
// sit under the cards. A new member sees how a tontine works and one button.
const OVERLAP = 60;
const GAP = 12;

export default function HomeScreen() {
  const { member } = useSession();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reloads every time home comes back into view, for example after she pays,
  // answers an invitation or creates a group.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        try {
          const [nextInvitations, nextGroups, nextNews] = await Promise.all([
            listMyInvitations(),
            listMyGroups(),
            listNews(3).catch(() => [] as NewsItem[]),
          ]);
          if (!active) return;
          setInvitations(nextInvitations);
          setGroups(nextGroups);
          setNews(nextNews);
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
  return (
    <HomeView
      name={member.displayName}
      groups={groups}
      invitations={invitations}
      news={news}
      loaded={loaded}
      error={error}
    />
  );
}

// What home shows, from data already loaded: kept apart from the loading so
// the layout can be checked with sample data.
export function HomeView({
  name,
  groups,
  invitations,
  news,
  loaded,
  error,
}: {
  name: string;
  groups: GroupSummary[];
  invitations: Invitation[];
  news: NewsItem[];
  loaded: boolean;
  error: string | null;
}) {
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);

  // Ewe screens still show French texts until a native speaker reviews them,
  // so the date follows the French.
  const dateLanguage = i18n.language === "ee" ? "fr" : i18n.language;
  const today = new Date().toLocaleDateString(dateLanguage, { weekday: "long", day: "numeric", month: "long" });
  const firstName = name.split(" ")[0] ?? name;

  // Running groups as cards, the ones where she still owes first.
  const running = cardsInOrder(groups);
  const preparing = groups.filter((g) => !g.currentRound && g.state !== "COMPLETED" && g.state !== "CANCELLED");
  const isNew = loaded && groups.length === 0;
  const cardWidth = width - 48;
  const newsToday = news.some((n) => !n.mine && Date.now() - Date.parse(n.createdAt) < 86_400_000);

  // What "Écouter" reads: her name, then this week in each group.
  const listenText = [
    t("hub.hello", { name: firstName }),
    today,
    ...running.map((g) =>
      owes(g) && g.currentRound
        ? `${g.name}. ${t("hub.pay", { amount: `${g.amountFcfa + (g.currentRound?.advanceFcfa ?? 0)} francs` })}.`
        : `${g.name}. ${t("hub.paid")}.`,
    ),
    ...news.map((n) => newsTitle(t, n)),
  ].join(". ");

  const tiles: { icon: LineIconName; label: string; onPress: () => void }[] = [
    { icon: "bank", label: t("hub.tileLoan"), onPress: () => router.push("/loan" as never) },
    { icon: "plus", label: t("hub.tileNew"), onPress: () => router.push("/groups/new") },
    ...(isNew ? [] : [{ icon: "qr" as const, label: t("hub.tileShare"), onPress: () => router.replace("/record" as never) }]),
  ];

  return (
    <Screen
      bleedTop
      bar={<BottomBar active="home" />}
      top={
        <LaguneBand overlap={OVERLAP}>
          <View style={styles.top}>
            <View style={styles.topText}>
              <Text style={styles.date}>{today}</Text>
              <Text style={styles.hello} numberOfLines={1}>
                {t("hub.hello", { name: firstName })}
              </Text>
            </View>
            <ListenRound text={listenText} style={styles.round} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("hub.news")}
              onPress={() => router.push("/news" as never)}
              style={styles.round}
              hitSlop={6}
            >
              <LineIcon name="bell" color={colors.white} size={22} />
              {newsToday ? <View style={styles.bellDot} /> : null}
            </Pressable>
          </View>
        </LaguneBand>
      }
    >
      <View style={styles.lift}>
        {running.length > 0 ? (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={cardWidth + GAP}
              decelerationRate="fast"
              contentContainerStyle={styles.cards}
              onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / (cardWidth + GAP)))}
              style={styles.cardsScroll}
            >
              {running.map((g) => (
                <GroupCard key={g.id} group={g} width={cardWidth} />
              ))}
            </ScrollView>
            {running.length > 1 ? (
              <View style={styles.pager} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {running.map((g, i) => (
                  <CowrieMark
                    key={g.id}
                    size={16}
                    rotate={90}
                    fill={i === page ? colors.accent : colors.white}
                  />
                ))}
              </View>
            ) : null}
          </>
        ) : isNew ? (
          <View style={styles.first}>
            <Text style={styles.firstTitle}>{t("hub.firstTitle")}</Text>
            <Text style={styles.firstText}>{t("hub.firstText")}</Text>
            <View style={styles.firstRow}>
              <SeatRing paid={[false, false, false, false, false, false]} size={92}>
                <CowrieMark size={40} rotate={30} />
              </SeatRing>
              <View style={styles.steps}>
                {["hub.firstStep1", "hub.firstStep2", "hub.firstStep3"].map((key, i) => (
                  <Text key={key} style={styles.step}>
                    <Text style={styles.bold}>{i + 1}. </Text>
                    {t(key)}
                  </Text>
                ))}
              </View>
            </View>
            <Pressable accessibilityRole="button" onPress={() => router.push("/groups/new")} style={styles.create}>
              <Text style={styles.createText}>{t("hub.create")}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <ErrorMessage messageKey={error} />

      {invitations.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.h}>{t("hub.invitationsTitle")}</Text>
          {invitations.map((invitation) => (
            <Pressable
              key={invitation.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/invitations/[id]", params: { id: invitation.id } })}
              style={[styles.box, styles.invite]}
            >
              <View style={[styles.avatar, { backgroundColor: "#7A4FB5" }]}>
                <Text style={styles.avatarText}>{invitation.organiserName.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.boxText}>
                <Text style={styles.boxTitle}>{t("hub.invites", { name: invitation.organiserName })}</Text>
                <Text style={styles.boxSub}>
                  {invitation.groupName} · {rulesSummary(t, invitation.rules)}
                </Text>
              </View>
              <LineIcon name="chevron" color={colors.accent} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {preparing.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.h}>{t("hub.waitingTitle")}</Text>
          {preparing.map((g) => (
            <Pressable
              key={g.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/groups/[id]", params: { id: g.id } })}
              style={styles.box}
            >
              <View style={styles.boxText}>
                <Text style={styles.boxTitle}>{g.name}</Text>
                <Text style={styles.boxSub}>
                  {stateLabel(t, g.state)} · {rulesSummary(t, g)}
                </Text>
              </View>
              <LineIcon name="chevron" color={colors.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <LoanCard />

      <View style={styles.section}>
        <Text style={styles.h}>{t("hub.forYou")}</Text>
        <View style={styles.tiles}>
          {tiles.map((tile) => (
            <Pressable key={tile.label} accessibilityRole="button" onPress={tile.onPress} style={styles.tile}>
              <View style={styles.tileIcon}>
                <LineIcon name={tile.icon} />
              </View>
              <Text style={styles.tileText}>{tile.label}</Text>
            </Pressable>
          ))}
          {tiles.length === 2 ? <View style={styles.tileSpacer} /> : null}
        </View>
      </View>

      {!isNew ? (
        <View style={styles.section}>
          <View style={styles.hRow}>
            <Text style={styles.h}>{t("hub.latest")}</Text>
            {news.length > 0 ? (
              <Pressable accessibilityRole="link" onPress={() => router.push("/news" as never)} hitSlop={10}>
                <Text style={styles.link}>{t("hub.seeAll")}</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.newsBox}>
            {news.length === 0 ? (
              <Text style={styles.empty}>{t("hub.noNews")}</Text>
            ) : (
              news.map((n, i) => <NewsRow key={n.id} item={n} first={i === 0} />)
            )}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  topText: { flex: 1, minWidth: 0 },
  date: { fontFamily: fonts.body, fontSize: 14, color: colors.onDark, opacity: 0.85 },
  hello: { fontFamily: fonts.bodyBold, fontSize: 24, lineHeight: 30, color: colors.white },
  round: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  bellDot: {
    position: "absolute",
    top: 8,
    right: 9,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  lift: { marginTop: -(OVERLAP + 20) },
  cardsScroll: { marginHorizontal: -24, overflow: "visible" },
  cards: { paddingHorizontal: 24, paddingBottom: 6, gap: GAP },
  pager: { flexDirection: "row", justifyContent: "center", gap: 4, marginTop: 14 },
  first: {
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 22,
    gap: 16,
    elevation: 4,
    shadowColor: colors.indigo,
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  firstTitle: { fontFamily: fonts.bodyBold, fontSize: 21, lineHeight: 27, color: colors.indigo },
  firstText: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted },
  firstRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  steps: { flex: 1, gap: 4 },
  step: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },
  bold: { fontFamily: fonts.bodyBold },
  create: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  createText: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.white },
  section: { gap: 14 },
  hRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  h: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.indigo },
  link: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.lagoon },
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  invite: { borderColor: colors.accent, borderWidth: 2 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.white },
  boxText: { flex: 1, minWidth: 0, gap: 2 },
  boxTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  boxSub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
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
  tileSpacer: { flex: 1 },
  tileIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.mist,
    alignItems: "center",
    justifyContent: "center",
  },
  tileText: { fontFamily: fonts.bodyBold, fontSize: 13, lineHeight: 17, color: colors.ink, textAlign: "center" },
  newsBox: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  empty: { fontFamily: fonts.body, fontSize: 15, color: colors.muted, paddingVertical: 14 },
});
