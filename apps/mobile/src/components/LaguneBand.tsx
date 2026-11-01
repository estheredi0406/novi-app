import { useFocusEffect } from "expo-router";
import { setStatusBarStyle } from "expo-status-bar";
import { type ReactNode, useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Pattern, Rect, Stop } from "react-native-svg";
import { colors } from "../theme/colors";

// The blue band at the top of home, Mes groupes and a group (D92). Novi's own
// pagne motif, an eight-petal flower in a ring with quarter circles in the
// corners (drawn for Novi, not copied from any wax house), printed blue on
// blue and darkened towards the bottom so white text stays readable. The
// white card below overlaps its lower edge.
const PETALS = [0, 45, 90, 135, 180, 225, 270, 315];

// The band reaches under the phone's status bar (the screen leaves that edge
// to it), and the status bar turns white while the screen is in view.
export function LaguneBand({ children, overlap = 64 }: { children: ReactNode; overlap?: number }) {
  const insets = useSafeAreaInsets();
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle("light");
      return () => setStatusBarStyle("dark");
    }, []),
  );
  return (
    <View style={[styles.band, { paddingTop: insets.top + 12, paddingBottom: overlap + 18 }]}>
      <Svg
        width="100%"
        height="100%"
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Defs>
          <Pattern id="pagne" width={84} height={84} patternUnits="userSpaceOnUse" viewBox="0 0 120 120">
            <Rect width={120} height={120} fill={colors.lagoon} />
            <G stroke="#0E5A9C" strokeWidth={4} fill="none">
              <Path d="M0 22 A22 22 0 0 0 22 0" />
              <Path d="M0 12 A12 12 0 0 0 12 0" />
              <Path d="M98 120 A22 22 0 0 1 120 98" />
              <Path d="M108 120 A12 12 0 0 1 120 108" />
              <Path d="M120 22 A22 22 0 0 1 98 0" />
              <Path d="M0 98 A22 22 0 0 1 22 120" />
            </G>
            {PETALS.map((a) => (
              <Ellipse key={a} cx={60} cy={38} rx={7} ry={15} fill="#0E5A9C" transform={`rotate(${a} 60 60)`} />
            ))}
            <Circle cx={60} cy={60} r={13} fill={colors.teal} opacity={0.55} />
            <Circle cx={60} cy={60} r={6} fill={colors.lagoon} />
          </Pattern>
          <LinearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.lagoon} stopOpacity={0.5} />
            <Stop offset="1" stopColor={colors.indigo} stopOpacity={0.93} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#pagne)" />
        <Rect width="100%" height="100%" fill="url(#shade)" />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { paddingHorizontal: 20, backgroundColor: colors.indigo },
});
