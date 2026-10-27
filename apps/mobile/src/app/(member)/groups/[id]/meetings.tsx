import type { GroupMeetingView, MeetingsPage } from "@novi/shared";
import { type Href, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Linking, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../../../api/client";
import { cancelMeeting, joinMeeting, listMeetings } from "../../../../api/groups";
import { BackHeader } from "../../../../components/BackHeader";
import { ErrorMessage } from "../../../../components/ErrorMessage";
import { HeaderBand } from "../../../../components/HeaderBand";
import { PrimaryButton } from "../../../../components/PrimaryButton";
import { Screen } from "../../../../components/Screen";
import { TextButton } from "../../../../components/TextButton";
import { WaxCard } from "../../../../components/WaxCard";
import { meetingWhen, opensIn } from "../../../../lib/meetingTime";
import { colors } from "../../../../theme/colors";
import { fonts } from "../../../../theme/typography";

// The group's meetings (D71): the next ones, with "Join" once the room is
// open (10 minutes before), and the last month's, with who came. The call
// opens in the phone's browser, microphone on and camera off.
export default function MeetingsScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [page, setPage] = useState<MeetingsPage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void listMeetings(id).then(
      (next) => {
        setPage(next);
        setError(null);
      },
      (err: unknown) => setError(errorKey(err)),
    );
  }, [id]);
  useFocusEffect(load);

  async function join(meeting: GroupMeetingView) {
    setBusy(meeting.id);
    setError(null);
    try {
      const { url } = await joinMeeting(id, meeting.id);
      await Linking.openURL(url);
      load();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(null);
    }
  }

  function cancel(meeting: GroupMeetingView) {
    Alert.alert(t("meetings.cancelTitle"), t("meetings.cancelBody", { title: meeting.title }), [
      { text: t("meetings.keep"), style: "cancel" },
      {
        text: t("meetings.cancel"),
        style: "destructive",
        onPress: () =>
          void cancelMeeting(id, meeting.id).then(setPage, (err: unknown) => setError(errorKey(err))),
      },
    ]);
  }

  const listen = page?.upcoming[0]
    ? `${t("meetings.title")}. ${page.upcoming[0].title}. ${meetingWhen(page.upcoming[0].startsAt, i18n.language)}`
    : t("meetings.title");

  return (
    <Screen
      top={
        <HeaderBand>
          <BackHeader listenText={listen} />
          <Text style={styles.bandName}>{t("meetings.title")}</Text>
          <Text style={styles.bandSub}>{t("meetings.hint")}</Text>
        </HeaderBand>
      }
    >
      <ErrorMessage messageKey={error} />

      {page?.canSchedule ? (
        <PrimaryButton
          label={t("meetings.schedule")}
          onPress={() => router.push(`/groups/${id}/meeting-new` as Href)}
        />
      ) : null}

      <Text style={styles.section}>{t("meetings.upcoming")}</Text>
      {page && page.upcoming.length === 0 ? <Text style={styles.empty}>{t("meetings.none")}</Text> : null}
      {page?.upcoming.map((meeting) => {
        const open = meeting.state === "OPEN";
        return (
          <WaxCard key={meeting.id} style={[styles.card, open && styles.cardOpen]}>
            {open ? <Text style={styles.live}>{t("meetings.openNow")}</Text> : null}
            <Text style={styles.title}>{meeting.title}</Text>
            <Text style={styles.when}>
              {meetingWhen(meeting.startsAt, i18n.language)} · {t("meetings.minutes", { count: meeting.durationMin })}
            </Text>
            {meeting.agenda ? <Text style={styles.agenda}>{meeting.agenda}</Text> : null}
            {meeting.joined.length > 0 ? (
              <Text style={styles.small}>{t("meetings.joined", { names: meeting.joined.join(", ") })}</Text>
            ) : null}
            {open ? (
              <PrimaryButton
                label={t("meetings.join")}
                disabled={busy === meeting.id}
                onPress={() => void join(meeting)}
              />
            ) : (
              <Text style={styles.small}>{opensIn(t, meeting.startsAt)}</Text>
            )}
            {open ? <Text style={styles.small}>{t("meetings.voiceFirst")}</Text> : null}
            {meeting.canCancel ? <TextButton label={t("meetings.cancel")} onPress={() => cancel(meeting)} /> : null}
          </WaxCard>
        );
      })}

      {page && page.past.length > 0 ? (
        <View style={styles.pastList}>
          <Text style={styles.section}>{t("meetings.past")}</Text>
          {page.past.map((meeting) => (
            <View key={meeting.id} style={styles.pastRow}>
              <Text style={styles.pastTitle}>
                {meeting.title}
                {meeting.state === "CANCELLED" ? ` · ${t("meetings.cancelled")}` : ""}
              </Text>
              <Text style={styles.small}>{meetingWhen(meeting.startsAt, i18n.language)}</Text>
              {meeting.state === "ENDED" ? (
                <Text style={styles.small}>
                  {meeting.joined.length > 0
                    ? t("meetings.joined", { names: meeting.joined.join(", ") })
                    : t("meetings.nobody")}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bandName: { fontFamily: fonts.display, fontSize: 28, color: colors.indigo },
  bandSub: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  section: { fontFamily: fonts.display, fontSize: 20, color: colors.indigo },
  empty: { fontFamily: fonts.body, fontSize: 16, color: colors.muted },
  card: { padding: 16, gap: 8 },
  cardOpen: { borderColor: colors.accent, borderWidth: 2.5 },
  live: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.accent, textTransform: "uppercase", letterSpacing: 0.6 },
  title: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.indigo },
  when: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  agenda: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.ink },
  small: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  pastList: { gap: 12 },
  pastRow: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: 10, gap: 2 },
  pastTitle: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.ink },
});
