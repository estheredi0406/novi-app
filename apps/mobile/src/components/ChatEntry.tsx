import { type Href, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { Glyph } from "./art/Glyph";
import { WaxCard } from "./WaxCard";

// The door to the group's chat (D70), with how many lines arrived since she
// last opened it.
export function ChatEntry({ groupId, unread }: { groupId: string; unread: number }) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t("chat.title")}. ${unread > 0 ? t("chat.unread", { count: unread }) : ""}`}
      onPress={() => router.push(`/groups/${groupId}/chat` as Href)}
    >
      <WaxCard style={styles.card}>
        <Svg width={44} height={44} viewBox="0 0 44 44">
          <Circle cx={22} cy={22} r={22} fill={colors.mist} />
          <Path
            d="M11 14 H33 A3 3 0 0 1 36 17 V27 A3 3 0 0 1 33 30 H20 L14 35 V30 H11 A3 3 0 0 1 8 27 V17 A3 3 0 0 1 11 14 Z"
            fill={colors.card}
            stroke={colors.indigo}
            strokeWidth={1.8}
            strokeLinejoin="round"
          />
          <Circle cx={16} cy={22} r={1.8} fill={colors.accent} />
          <Circle cx={22} cy={22} r={1.8} fill={colors.teal} />
          <Circle cx={28} cy={22} r={1.8} fill={colors.indigo} />
        </Svg>
        <View style={styles.text}>
          <Text style={styles.title}>{t("chat.title")}</Text>
          <Text style={styles.sub}>{unread > 0 ? t("chat.unread", { count: unread }) : t("chat.entryHint")}</Text>
        </View>
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
          </View>
        ) : null}
        <Glyph name="chevron" color={colors.indigo} />
      </WaxCard>
    </Pressable>
  );
}

// The small orange count on home's group rows.
export function UnreadDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14 },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.indigo },
  sub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  badge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 7,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.white },
});
