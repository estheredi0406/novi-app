import type { GroupDetail, MeetingsPage, RoundSummary } from "@novi/shared";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { formatFcfa } from "../../lib/format";
import { rulesSummary } from "../../lib/rulesText";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";
import { BackHeader } from "../BackHeader";
import { CotisationTab } from "./CotisationTab";
import { GroupChat } from "./GroupChat";
import { GroupInfoTab } from "./GroupInfoTab";

export type GroupTab = "cotisation" | "discussion" | "groupe";
export const GROUP_TABS: GroupTab[] = ["cotisation", "discussion", "groupe"];

// A running group (approved design F1 to F3): one header with the name and
// the rules in a line, and three tabs, so nothing is stacked on one long
// page. The tab is in the address (?tab=), so a notification or the back
// button returns to the same place.
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
    group.cycleNumber > 1 ? t("cycle.number", { number: group.cycleNumber }) : null,
    rulesSummary(t, group.rules),
    t("groupInfo.members", { count: group.rules.size }),
  ]
    .filter(Boolean)
    .join(" · ");

  // Listen reads what the open tab is about, in a few words.
  const listen =
    tab === "cotisation" && current
      ? `${group.name}. ${t("groupView.roundOf", { number: current.number, total: rounds.length })}. ${formatFcfa(group.rules.amountFcfa)}.`
      : tab === "discussion"
        ? `${group.name}. ${t("tabs.discussion")}. ${t("chat.safety")}`
        : `${group.name}. ${t("groupInfo.whoWhen")}.`;

  const select = (next: GroupTab) => router.setParams({ tab: next });

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.band}>
        <BackHeader listenText={listen} />
        <Text style={styles.name} numberOfLines={1}>
          {group.name}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {sub}
        </Text>
        <View style={styles.tabs} accessibilityRole="tablist">
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
      </View>

      {tab === "discussion" ? (
        <GroupChat groupId={group.id} nextMeeting={meetings?.upcoming[0] ?? null} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {tab === "cotisation" ? (
            <CotisationTab group={group} rounds={rounds} memberId={memberId} onChanged={onChanged} />
          ) : (
            <GroupInfoTab group={group} rounds={rounds} memberId={memberId} />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.shell },
  band: {
    backgroundColor: colors.mist,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.indigo,
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 4,
  },
  name: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32, color: colors.indigo, marginTop: 4 },
  sub: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.muted },
  tabs: { flexDirection: "row", marginTop: 8 },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 48,
    borderBottomWidth: 4,
    borderBottomColor: "transparent",
  },
  tabOn: { borderBottomColor: colors.accent },
  tabText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.muted },
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
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.white },
  content: { paddingHorizontal: 20, paddingVertical: 18, gap: 18, flexGrow: 1 },
});
