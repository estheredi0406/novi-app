import type { GroupSummary, Invitation, MySavings, NewsItem } from "@novi/shared";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../api/client";
import { listMyGroups, listMyInvitations } from "../../api/groups";
import { answerReceipt } from "../../api/money";
import { listNews } from "../../api/news";
import { getSavings } from "../../api/savings";
import { formatFcfa, shortDay } from "../../lib/format";
import { BottomBar, CowrieMark } from "../../components/BottomBar";
import { ErrorMessage } from "../../components/ErrorMessage";
import { PrimaryButton } from "../../components/PrimaryButton";
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
import { useAppWidth } from "../../components/WebFrame";

// Home, direction "Lagune" (D92, boards E1 to E3 and E7), built like the bank
// and mobile money apps traders already use: a blue band with her name, one
// card per running group (swipe between them) with that group's own actions
// on it, then "Pour vous" (things about her, never about one group), then the
// latest news from all her groups. Invitations and groups still being set up
// sit under the cards. A new member sees how a tontine works and one button.
// The rounded group card rides over the band's lower edge (D122).
const OVERLAP = 28;
const CARD_SIDE = 16;
const CARD_GAP = 12;

export default function HomeScreen() {
  const { member } = useSession();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [savings, setSavings] = useState<MySavings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Reloads every time home comes back into view, for example after she pays,
  // answers an invitation or creates a group.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        try {
          const [nextInvitations, nextGroups, nextNews, nextSavings] = await Promise.all([
            listMyInvitations(),
            listMyGroups(),
            listNews(3).catch(() => [] as NewsItem[]),
            getSavings().catch(() => null),
          ]);
          if (!active) return;
          setSavings(nextSavings);
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
    }, [tick]),
  );

  if (!member) return null;
  return (
    <HomeView
      name={member.displayName}
      groups={groups}
      invitations={invitations}
      news={news}
      savings={savings}
      loaded={loaded}
      error={error}
      onChanged={() => setTick((n) => n + 1)}
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
  savings = null,
  loaded,
  error,
  onChanged,
}: {
  name: string;
  groups: GroupSummary[];
  invitations: Invitation[];
  news: NewsItem[];
  savings?: MySavings | null;
  loaded: boolean;
  error: string | null;
  onChanged?: () => void;
}) {
  const { t, i18n } = useTranslation();
  // D139: a pot that reached her wallet waits for her "did it arrive?" on
  // home, first thing under the cards, not only inside the group.
  const toConfirm = groups.flatMap((g) =>
    g.currentRound?.myTurn?.confirm
      ? [{ group: g, number: g.currentRound.myTurn.number, ...g.currentRound.myTurn.confirm }]
      : [],
  );
  const [answering, setAnswering] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  async function answer(payoutId: string, received: boolean) {
    setAnswering(payoutId);
    setAnswerError(null);
    try {
      await answerReceipt(payoutId, received);
      onChanged?.();
    } catch (err) {
      setAnswerError(errorKey(err));
    } finally {
      setAnswering(null);
    }
  }
  const { width } = useAppWidth();
  const [page, setPage] = useState(0);
  const cardsRef = useRef<ScrollViewInstance>(null);
  // D147: asked from the day she joins until the group starts; after that,
  // an unanswered pot goes to her mobile money (the group card says so).
  // Before the start; once the group runs, her card asks (D151).
  const toChoose = savings?.choices.filter((c) => !c.chosen && !c.started) ?? [];

  // Ewe screens still show French texts until a native speaker reviews them,
  // so the date follows the French.
  const dateLanguage = i18n.language === "ee" ? "fr" : i18n.language;
  const today = new Date().toLocaleDateString(dateLanguage, { weekday: "long", day: "numeric", month: "long" });
  const firstName = name.split(" ")[0] ?? name;

  // Running groups as cards, the ones where she still owes first.
  const running = cardsInOrder(groups);
  const preparing = groups.filter((g) => !g.currentRound && g.state !== "COMPLETED" && g.state !== "CANCELLED");
  const isNew = loaded && groups.length === 0;
  const cardWidth = width - 2 * CARD_SIDE;
  const step = cardWidth + CARD_GAP;
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
    // D142: her savings at the caisse, always one touch away.
    { icon: "hand", label: t("hub.tileSavings"), onPress: () => router.push("/savings" as never) },
    { icon: "plus", label: t("hub.tileNew"), onPress: () => router.push("/groups/new") },
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
              ref={cardsRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={step}
              decelerationRate="fast"
              contentContainerStyle={styles.cards}
              onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / step))}
              style={styles.cardsScroll}
            >
              {running.map((g) => (
                <GroupCard
                  key={g.id}
                  group={g}
                  width={cardWidth}
                  choice={savings?.choices.find((c) => c.groupId === g.id) ?? null}
                />
              ))}
            </ScrollView>
            {/* D153: her groups by name, under the card: a tap shows that
                group's card (swiping still works). Orange dot: she owes there. */}
            {running.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
                {running.map((g, i) => (
                  <Pressable
                    key={g.id}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: i === page }}
                    onPress={() => {
                      setPage(i);
                      cardsRef.current?.scrollTo({ x: i * step, animated: true });
                    }}
                    style={[styles.tab, i === page && styles.tabOn]}
                  >
                    {owes(g) ? <View style={styles.tabDot} /> : null}
                    <Text style={[styles.tabText, i === page && styles.tabTextOn]} numberOfLines={1}>
                      {g.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
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

      {toConfirm.length > 0 ? (
        <View style={styles.section}>
          {toConfirm.map((c) => (
            <View key={c.payoutId} style={[styles.box, styles.invite, styles.confirm]}>
              <View style={styles.confirmHead}>
                <View style={[styles.avatar, { backgroundColor: colors.turnSoft }]}>
                  <CowrieMark size={22} fill={colors.yourTurn} />
                </View>
                <View style={styles.boxText}>
                  <Text style={styles.boxTitle}>
                    {t("groupView.receiptTitle", {
                      amount: formatFcfa(c.amountFcfa).replace(" FCFA", " F"),
                      number: c.number,
                    })}
                  </Text>
                  <Text style={styles.boxSub}>
                    {c.group.name} · {t("groupView.receiptHint", { mfi: c.group.mfiName })}
                  </Text>
                </View>
              </View>
              <PrimaryButton
                label={t("groupView.receiptYes")}
                disabled={answering !== null}
                onPress={() => void answer(c.payoutId, true)}
              />
              <Pressable
                accessibilityRole="button"
                disabled={answering !== null}
                onPress={() => void answer(c.payoutId, false)}
                style={styles.confirmNo}
              >
                <Text style={styles.link}>{t("groupView.receiptNo")}</Text>
              </Pressable>
            </View>
          ))}
          <ErrorMessage messageKey={answerError} />
        </View>
      ) : null}

      {/* D123: three days before her pot, where it goes; then her savings.
          D144: once she has answered, the question leaves home: her choice
          shows on the group card, with "Modifier" while it can change. */}
      {savings && (toChoose.length > 0 || savings.accounts.length > 0) ? (
        <View style={styles.section}>
          {toChoose.map((c) => (
            <Pressable
              key={c.roundId ?? c.groupId}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/savings-choice" as never, params: { group: c.groupId } })}
              style={[styles.box, styles.invite]}
            >
              <View style={[styles.avatar, { backgroundColor: colors.turnSoft }]}>
                <CowrieMark size={22} fill={colors.yourTurn} />
              </View>
              <View style={styles.boxText}>
                {/* D125: the question first, then the amount and the day. */}
                <Text style={styles.boxTitle}>{t("savings.homeChoicePre")}</Text>
                <Text style={styles.boxSub}>{t("savings.homeChoicePreSub", { group: c.groupName })}</Text>
              </View>
              <LineIcon name="chevron" color={colors.action} />
            </Pressable>
          ))}
          {savings.accounts.map((a) => (
            <Pressable
              key={a.id}
              accessibilityRole="button"
              onPress={() => router.push("/savings" as never)}
              style={styles.box}
            >
              <View style={[styles.avatar, { backgroundColor: colors.turnSoft }]}>
                <CowrieMark size={22} fill={colors.yourTurn} />
              </View>
              <View style={styles.boxText}>
                <Text style={styles.boxSub}>{t("savings.homeSavings", { mfi: a.mfiName })}</Text>
                <Text style={styles.savingsAmount}>
                  {a.status === "OPEN" ? formatFcfa(a.totalFcfa).replace(" FCFA", " F") : t("savings.homeOpening")}
                </Text>
              </View>
              <LineIcon name="chevron" color={colors.action} />
            </Pressable>
          ))}
        </View>
      ) : null}

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
              <View style={[styles.avatar, { backgroundColor: colors.mist }]}>
                <Text style={[styles.avatarText, { color: colors.lagoon }]}>{invitation.organiserName.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={styles.boxText}>
                <Text style={styles.boxTitle}>{t("hub.invites", { name: invitation.organiserName })}</Text>
                <Text style={styles.boxSub}>
                  {invitation.groupName} · {rulesSummary(t, invitation.rules)}
                </Text>
              </View>
              <LineIcon name="chevron" color={colors.action} />
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
        {/* D142: two tiles per row, so each label fits on one or two lines. */}
        <View style={styles.tileRows}>
          {[0, 2].filter((i) => i < tiles.length).map((i) => (
            <View key={i} style={styles.tiles}>
              {tiles.slice(i, i + 2).map((tile) => (
                <Pressable key={tile.label} accessibilityRole="button" onPress={tile.onPress} style={styles.tile}>
                  <View style={styles.tileIcon}>
                    <LineIcon name={tile.icon} />
                  </View>
                  <Text style={styles.tileText}>{tile.label}</Text>
                </Pressable>
              ))}
              {tiles.slice(i, i + 2).length === 1 ? <View style={styles.tileSpacer} /> : null}
            </View>
          ))}
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
  // The group card is rounded and rides over the band (D122).
  lift: { marginTop: -20 - OVERLAP, marginHorizontal: -24 },
  cardsScroll: { overflow: "visible" },
  cards: { gap: CARD_GAP, paddingHorizontal: CARD_SIDE },
  tabs: { gap: 8, paddingHorizontal: CARD_SIDE, paddingTop: 14, paddingBottom: 4 },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    maxWidth: 200,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  tabOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  tabText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },
  tabTextOn: { color: colors.white },
  tabDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  first: {
    marginHorizontal: 24,
    marginTop: 20,
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
    backgroundColor: colors.action,
    alignItems: "center",
    justifyContent: "center",
  },
  createText: { textAlign: "center", fontFamily: fonts.bodyBold, fontSize: 18, color: colors.white },
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
  confirm: { flexDirection: "column", alignItems: "stretch", gap: 14 },
  confirmHead: { flexDirection: "row", alignItems: "center", gap: 14 },
  confirmNo: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  savingsAmount: { fontFamily: fonts.display, fontSize: 20, lineHeight: 28, color: colors.indigo },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.white },
  boxText: { flex: 1, minWidth: 0, gap: 2 },
  boxTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  boxSub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  tileRows: { gap: 12 },
  tiles: { flexDirection: "row", gap: 12 },
  tile: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  tileSpacer: { flex: 1 },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.mist,
    alignItems: "center",
    justifyContent: "center",
  },
  tileText: { flex: 1, minWidth: 0, fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 18, color: colors.ink },
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
