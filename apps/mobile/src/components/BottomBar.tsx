import { type Href, router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { Cowrie } from "./art/Cowrie";

// The bar at the bottom of home, record and me (option B, 25 Oct): white,
// fine navy line, the active tab sitting on an orange cowrie. It fills the
// space under it down to the phone's edge. (Href: "/me" is typed once Expo
// regenerates its route list.)
type Tab = "home" | "record" | "me";
const ROUTES = { home: "/home", record: "/record", me: "/me" } as const;

function Icon({ tab, active }: { tab: Tab; active: boolean }) {
  return (
    <Svg width={48} height={36} viewBox="-2 -1 48 36">
      {/* The active tab sits on an orange cowrie, as the leaf did before. */}
      {active ? <Cowrie cx={19} cy={19} rx={10} ry={17} rotate={70} strokeWidth={1.3} /> : null}
      {tab === "home" ? (
        <>
          <Path
            d="M13 17 L22 9.5 L31 17"
            stroke={colors.indigo}
            strokeWidth={1.8}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M15 16 V26 H29 V16"
            stroke={colors.indigo}
            strokeWidth={1.8}
            fill={colors.mist}
            strokeLinejoin="round"
          />
          <Path
            d="M20 26 V21.5 C20 20 24 20 24 21.5 V26"
            stroke={colors.indigo}
            strokeWidth={1.6}
            fill={colors.teal}
            strokeLinejoin="round"
          />
        </>
      ) : tab === "record" ? (
        <>
          <Path
            d="M17 20 L15 30 L22 27 L29 30 L27 20"
            stroke={colors.indigo}
            strokeWidth={1.5}
            fill={colors.mist}
            strokeLinejoin="round"
          />
          <Circle cx={22} cy={14} r={8} stroke={colors.indigo} strokeWidth={1.5} fill={colors.shell} />
          <Circle cx={22} cy={14} r={4} fill={colors.accent} stroke={colors.indigo} strokeWidth={1.3} />
        </>
      ) : (
        <>
          <Circle cx={22} cy={17} r={10} fill={colors.mist} stroke={colors.indigo} strokeWidth={1.5} />
          <Circle cx={22} cy={14.5} r={3.6} fill={colors.shell} stroke={colors.indigo} strokeWidth={1.5} />
          <Path
            d="M15.8 24 C16.8 20.8 19 19.5 22 19.5 C25 19.5 27.2 20.8 28.2 24"
            fill={colors.teal}
            stroke={colors.indigo}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        </>
      )}
    </Svg>
  );
}

export function BottomBar({ active }: { active: Tab }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(4, insets.bottom) }]} accessibilityRole="tablist">
      {(["home", "record", "me"] as const).map((tab) => {
        const on = tab === active;
        return (
          <Pressable
            key={tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => (on ? undefined : router.replace(ROUTES[tab] as Href))}
            style={styles.tab}
          >
            <Icon tab={tab} active={on} />
            <Text style={[styles.label, on && styles.on]}>{t(`nav.${tab}`)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.indigo,
    paddingTop: 6,
  },
  tab: { flex: 1, alignItems: "center", gap: 0, minHeight: 56, justifyContent: "center" },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.muted },
  on: { fontFamily: fonts.bodyBold, color: colors.indigo },
});
