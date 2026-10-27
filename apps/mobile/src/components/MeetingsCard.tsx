import type { MeetingsPage } from "@novi/shared";
import { type Href, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { meetingWhen } from "../lib/meetingTime";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { Glyph } from "./art/Glyph";
import { WaxCard } from "./WaxCard";

// The group's next meeting on its page (D71), or an invitation to plan one.
export function MeetingsCard({ groupId, page }: { groupId: string; page: MeetingsPage | null }) {
  const { t, i18n } = useTranslation();
  const next = page?.upcoming[0];
  const open = next?.state === "OPEN";
  const sub = next
    ? meetingWhen(next.startsAt, i18n.language)
    : page?.canSchedule
      ? t("meetings.noneOrganiser")
      : t("meetings.none");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t("meetings.title")}. ${next ? `${next.title}. ${sub}` : sub}`}
      onPress={() => router.push(`/groups/${groupId}/meetings` as Href)}
    >
      <WaxCard style={[styles.card, open && styles.open]}>
        <Svg width={44} height={44} viewBox="0 0 44 44">
          <Circle cx={22} cy={22} r={22} fill={open ? colors.accent : colors.mist} />
          <Rect x={9} y={15} width={18} height={14} rx={3} fill={colors.card} stroke={colors.indigo} strokeWidth={1.8} />
          <Path d="M27 20 L35 15 V29 L27 24 Z" fill={colors.card} stroke={colors.indigo} strokeWidth={1.8} strokeLinejoin="round" />
        </Svg>
        <View style={styles.text}>
          <Text style={styles.label}>{open ? t("meetings.openNow") : t("meetings.title")}</Text>
          {next ? <Text style={styles.title} numberOfLines={1}>{next.title}</Text> : null}
          <Text style={styles.sub}>{sub}</Text>
        </View>
        <Glyph name="chevron" color={colors.indigo} />
      </WaxCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  open: { borderColor: colors.accent, borderWidth: 2.5 },
  text: { flex: 1, gap: 2 },
  label: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.accent, textTransform: "uppercase", letterSpacing: 0.6 },
  title: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.indigo },
  sub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
});
