import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { G, Path } from "react-native-svg";
import { colors } from "../theme/colors";

// The lavender band at the top of home, record and me: crackle lines like
// the dye cracks of a wax print, with one orange and one teal leaf. Drawn
// for this app from the fabric's language, not copied from a design.
export function HeaderBand({ children }: { children: ReactNode }) {
  return (
    <View style={styles.band}>
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 390 170" preserveAspectRatio="xMidYMid slice">
        <G stroke={colors.crackle} strokeWidth={1.4} fill="none">
          <Path d="M0 44 C40 30 70 64 110 44 S180 20 220 48 S300 70 340 42 S380 34 400 50" />
          <Path d="M0 120 C40 102 80 140 120 116 S190 94 230 126 S310 142 350 114 S384 106 400 120" />
          <Path d="M100 0 C110 40 86 80 108 120 S120 160 102 170" />
          <Path d="M250 0 C240 50 266 90 246 130 S238 160 254 170" />
        </G>
        <G stroke={colors.indigo} strokeWidth={1.6} strokeLinejoin="round">
          <Path d="M330 -10 C380 0 404 50 396 100 C364 82 334 56 330 -10 Z" fill={colors.accent} />
          <Path d="M-30 150 C30 126 90 150 110 210 C50 220 0 200 -30 150 Z" fill={colors.teal} />
        </G>
      </Svg>
      <View style={styles.inner}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: { backgroundColor: colors.mist, borderBottomWidth: 1.5, borderBottomColor: colors.indigo, overflow: "hidden" },
  inner: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 22, gap: 6 },
});
