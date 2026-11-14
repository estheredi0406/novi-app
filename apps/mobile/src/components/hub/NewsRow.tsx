import type { NewsItem } from "@novi/shared";
import { router } from "expo-router";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { readNotice } from "../../api/news";
import { formatDay } from "../../lib/format";
import { LineIcon } from "../LineIcon";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

// One line of "Dernières nouvelles" (D92), like a line in a bank statement:
// who, what, which group and when on the left, the amount on the right. Her
// own payments are in night blue with a minus; others' money is muted, since
// it is not her money moving. Opens the group's discussion, where the same
// line sits among the messages.

export function newsTitle(t: TFunction, item: NewsItem): string {
  if (item.notice) return item.notice.title;
  const who = item.who ?? t("news.someone");
  if (item.event === "MEETING_SCHEDULED") {
    return t("news.MEETING_SCHEDULED", { date: item.meetingStartsAt ? formatDay(item.meetingStartsAt) : "" });
  }
  return t(item.mine ? `news.${item.event}_mine` : `news.${item.event}`, { who });
}

// "9 h 12" today, "hier", or the date.
export function when(iso: string, language: string, t: TFunction, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) {
    const h = d.getUTCHours();
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    return language === "en" ? `${h}:${m}` : `${h} h ${m}`;
  }
  if (diff === 1) return t("news.yesterday");
  return formatDay(iso);
}

export function NewsRow({ item, first }: { item: NewsItem; first?: boolean }) {
  const { t, i18n } = useTranslation();
  if (item.notice) return <NoticeRow item={item} notice={item.notice} first={first} />;
  const money = item.amountFcfa
    ? `${item.mine && item.event === "PAID" ? "− " : item.mine && item.event === "POT_PAID" ? "+ " : ""}${String(
        item.amountFcfa,
      ).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} F`
    : "";
  const tone = item.mine ? (item.event === "POT_PAID" ? colors.paid : colors.indigo) : colors.muted;
  const initial = item.mine ? "✓" : (item.who ?? "?").slice(0, 1).toUpperCase();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: "/groups/[id]", params: { id: item.groupId, tab: "discussion" } })}
      style={[styles.row, !first && styles.divider]}
    >
      <View style={[styles.avatar, { backgroundColor: item.mine ? colors.paid : colors.mist }]}>
        <Text style={[styles.avatarText, !item.mine && styles.avatarTextPerson]}>{initial}</Text>
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={2}>
          {newsTitle(t, item)}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {t("news.ago", { group: item.groupName, when: when(item.createdAt, i18n.language, t) })}
        </Text>
      </View>
      {money ? <Text style={[styles.amount, { color: tone }]}>{money}</Text> : null}
    </Pressable>
  );
}

// D157: a notification Novi sent her, kept here for members whose phone got
// no push. Unread: an orange dot and bold text, first in the list; a tap
// marks it read and opens the screen it is about.
function NoticeRow({
  item,
  notice,
  first,
}: {
  item: NewsItem;
  notice: NonNullable<NewsItem["notice"]>;
  first?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [read, setRead] = useState(notice.read);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        setRead(true);
        void readNotice(item.id).catch(() => undefined);
        router.push(notice.url as never);
      }}
      style={[styles.row, !first && styles.divider]}
    >
      <View style={[styles.avatar, { backgroundColor: read ? colors.mist : colors.turnSoft }]}>
        <LineIcon name="bell" color={read ? colors.lagoon : colors.accent} size={20} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.title, read && styles.titleRead]} numberOfLines={2}>
          {notice.title}
        </Text>
        <Text style={styles.sub} numberOfLines={2}>
          {notice.body} · {when(item.createdAt, i18n.language, t)}
        </Text>
      </View>
      {read ? null : <View style={styles.unreadDot} accessibilityLabel={t("news.unread")} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.white },
  // People are one neutral colour (D121): colour is kept for meaning.
  avatarTextPerson: { color: colors.lagoon },
  text: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, lineHeight: 20, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  amount: { fontFamily: fonts.bodyBold, fontSize: 15 },
  titleRead: { fontFamily: fonts.body },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
});
