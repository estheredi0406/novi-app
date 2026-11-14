import type { GroupDetail, MeetingsPage, RoundSummary } from "@novi/shared";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatFcfa } from "../../lib/format";
import { rulesSummary } from "../../lib/rulesText";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";
import { errorKey } from "../../api/client";
import { callGroup } from "../../api/groups";
import { openCall } from "../../lib/openCall";
import { useKeyboardOpen } from "../../lib/keyboard";
import { stopSpeaking } from "../../lib/speak";
import { ErrorMessage } from "../ErrorMessage";
import { LaguneBand } from "../LaguneBand";
import { LineIcon } from "../LineIcon";
import { ListenRound } from "../ListenButton";
import { CotisationTab } from "./CotisationTab";
import { GroupChat } from "./GroupChat";
import { GroupInfoTab } from "./GroupInfoTab";

export type GroupTab = "cotisation" | "discussion" | "groupe";
export const GROUP_TABS: GroupTab[] = ["cotisation", "discussion", "groupe"];

// A running group (D92): the band with the name and rules, then three tabs.
// The tab is kept in the address (?tab=), so a notification or the back button
// returns to the same place.
export function RunningGroup({
  group,
  rounds,
  meetings,
  memberId,
  tab,
  onChanged,
}: {
  group: GroupDetail;
  rounds: RoundSummary[];
  meetings: MeetingsPage | null;
  memberId: string;
  tab: GroupTab;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const current = rounds.find((r) => r.isCurrent);
  const sub = [
    group.cycleNumber > 1
      ? t("cycle.number", { number: group.cycleNumber })
      : null,
    rulesSummary(t, group.rules), // already ends with the number of members
  ]
    .filter(Boolean)
    .join(" · ");

  // A reading about one tab stops when she opens another (D99).
  useEffect(() => stopSpeaking, [tab]);
  // D161: typing in the chat folds the header to the group's name.
  const folded = useKeyboardOpen() && tab === "discussion";

  // Listen reads what the open tab is about, in a few words.
  const listen =
    tab === "cotisation" && current
      ? `${group.name}. ${t("groupView.roundOf", { number: current.number, total: rounds.length })}. ${formatFcfa(group.rules.amountFcfa)}.`
      : tab === "discussion"
        ? `${group.name}. ${t("tabs.discussion")}. ${t("chat.safety")}`
        : `${group.name}. ${t("groupInfo.whoWhen")}.`;

  const select = (next: GroupTab) => router.setParams({ tab: next });
  const organiser = group.seats.find((seat) => seat.role === "ORGANISER")?.displayName;
  const [calling, setCalling] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

  // The phone at the top right: joins the group's open call or starts one
  // (D76), inside Novi (D85).
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
    <SafeAreaView
      style={styles.safe}
      edges={["left", "right", "bottom"]}
    >
      <LaguneBand overlap={0}>
        <View style={styles.topRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))}
            style={styles.round}
            hitSlop={6}
          >
            <Text style={styles.back}>‹</Text>
          </Pressable>
          <View style={styles.topActions}>
            <ListenRound text={listen} style={styles.round} />
            {group.state === "ACTIVE" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("hub.callGroup")}
                onPress={() => void call()}
                disabled={calling}
                style={[styles.round, calling && styles.busy]}
                hitSlop={6}
              >
                <LineIcon name="phone" color={colors.white} size={20} />
              </Pressable>
            ) : null}
          </View>
        </View>
        <Text style={styles.name} numberOfLines={2}>
          {group.name}
        </Text>
        {folded ? null : <Text style={styles.sub}>{sub}</Text>}
        {organiser && !folded ? (
          <Text style={styles.sub}>
            {t("groupView.organisedBy", { name: organiser })} · {t("groupView.heldBy", { mfi: group.mfiName })}
          </Text>
        ) : null}
      </LaguneBand>
      <View style={styles.segmentWrap}>
        <View style={styles.segment} accessibilityRole="tablist">
          {GROUP_TABS.map((key) => {
            const on = key === tab;
            const unread = key === "discussion" && !on ? group.unreadMessages : 0;
            return (
              <Pressable
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => select(key)}
                style={[styles.tab, on && styles.tabOn]}
              >
                <Text style={[styles.tabText, on && styles.tabTextOn]}>{t(`tabs.${key}`)}</Text>
                {unread > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        <ErrorMessage messageKey={callError} />
      </View>

      {tab === "discussion" ? (
        <GroupChat
          groupId={group.id}
          nextMeeting={meetings?.upcoming[0] ?? null}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {tab === "cotisation" ? (
            <CotisationTab
              group={group}
              rounds={rounds}
              memberId={memberId}
              onChanged={onChanged}
            />
          ) : (
            <GroupInfoTab
              group={group}
              rounds={rounds}
              memberId={memberId}
              onChanged={onChanged}
            />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.shell },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  topActions: { flexDirection: "row", gap: 8 },
  round: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  busy: { opacity: 0.5 },
  back: { textAlign: "center", fontSize: 30, lineHeight: 34, marginTop: -3, color: colors.white },
  name: { fontFamily: fonts.bodyBold, fontSize: 24, lineHeight: 30, color: colors.white, marginTop: 8 },
  sub: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.onDark, opacity: 0.88 },
  segmentWrap: { paddingHorizontal: 20, paddingTop: 16, gap: 6 },
  segment: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 14, backgroundColor: colors.mist },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
    borderRadius: 11,
  },
  tabOn: {
    backgroundColor: colors.white,
    elevation: 2,
    shadowColor: colors.indigo,
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  tabText: { textAlign: "center", fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.muted },
  tabTextOn: { fontFamily: fonts.bodyBold, color: colors.indigo },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { textAlign: "center", fontFamily: fonts.bodyBold, fontSize: 12, color: colors.white },
  content: { paddingHorizontal: 20, paddingVertical: 20, gap: 24, flexGrow: 1 },
});
