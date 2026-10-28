import type { GroupMeetingView } from "@novi/shared";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getGroup, listMeetings } from "../../../../api/groups";
import { BackHeader } from "../../../../components/BackHeader";
import { GroupChat } from "../../../../components/group/GroupChat";
import { HeaderBand } from "../../../../components/HeaderBand";
import { colors } from "../../../../theme/colors";
import { fonts } from "../../../../theme/typography";

// The group's chat on its own screen, while the group is still being set
// up (to talk the rules through). Once it runs, the chat is the group's
// "Discussion" tab: the same chat, the same calls and voice notes.
export default function ChatScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState("");
  const [next, setNext] = useState<GroupMeetingView | null>(null);

  useEffect(() => {
    void getGroup(id).then((g) => setName(g.name), () => undefined);
    void listMeetings(id).then((page) => setNext(page.upcoming[0] ?? null), () => undefined);
  }, [id]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <HeaderBand>
        <BackHeader listenText={`${t("chat.title")}. ${name}. ${t("chat.safety")}`} />
        <Text style={styles.bandName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.bandSub}>{t("chat.title")}</Text>
      </HeaderBand>
      <GroupChat groupId={id} nextMeeting={next} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.shell },
  bandName: { fontFamily: fonts.display, fontSize: 26, color: colors.indigo },
  bandSub: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.muted },
});
