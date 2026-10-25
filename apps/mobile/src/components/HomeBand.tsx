import type { ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { colors } from "../theme/colors";
import { Cowrie } from "./art/Cowrie";

// Home's wax-print band: lavender crackle, cowrie shells (West Africa's old
// money, Novi's motif for savings) and navy seed dots, ending in a soft wave.
export function HomeBand({ children }: { children: ReactNode }) {
  // The wave is drawn at the screen width so it reaches both edges.
  const { width } = useWindowDimensions();
  return (
    <View style={styles.band}>
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 390 330" preserveAspectRatio="xMidYMax slice">
        <G stroke={colors.crackle} strokeWidth={1.6} fill="none" opacity={0.9}>
          <Path d="M0 40 C30 30 50 60 80 44 S130 20 160 46 S220 70 250 40 S310 20 340 50 S380 60 400 40" />
          <Path d="M0 110 C40 96 60 130 100 112 S160 86 200 118 S260 140 300 110 S360 90 400 120" />
          <Path d="M0 190 C30 176 70 210 110 186 S170 160 210 196 S280 214 320 186 S370 170 400 196" />
          <Path d="M0 270 C40 250 80 290 120 262 S190 240 230 276 S300 294 340 264 S380 250 400 270" />
          <Path d="M30 0 C40 40 20 70 44 110 S60 180 36 220 S50 300 30 330" />
          <Path d="M120 0 C110 50 140 80 118 130 S100 210 126 250 S110 310 124 330" />
          <Path d="M210 0 C220 40 196 90 214 130 S236 200 210 240 S226 300 212 330" />
          <Path d="M300 0 C292 50 318 90 296 140 S280 210 306 250 S290 300 302 330" />
        </G>
        <Cowrie cx={322} cy={52} rx={44} ry={64} rotate={35} />
        <Cowrie cx={362} cy={226} rx={24} ry={38} rotate={-20} fill={colors.shell} />
        <Cowrie cx={40} cy={292} rx={32} ry={48} rotate={60} />
        <Cowrie cx={238} cy={246} rx={13} ry={20} rotate={80} fill={colors.teal} strokeWidth={1.3} />
        {/* Smaller shells scattered like cowries tipped from a calabash. */}
        <Cowrie cx={250} cy={120} rx={11} ry={17} rotate={-30} fill={colors.shell} strokeWidth={1.2} />
        <Cowrie cx={268} cy={150} rx={9} ry={14} rotate={20} strokeWidth={1.2} />
        <Cowrie cx={286} cy={132} rx={10} ry={15} rotate={70} fill={colors.teal} strokeWidth={1.2} />
        <Cowrie cx={160} cy={300} rx={14} ry={22} rotate={-60} fill={colors.shell} strokeWidth={1.3} />
        <Cowrie cx={190} cy={316} rx={10} ry={16} rotate={30} strokeWidth={1.2} />
        <Cowrie cx={90} cy={60} rx={9} ry={14} rotate={110} fill={colors.shell} strokeWidth={1.2} />
        <Cowrie cx={380} cy={120} rx={10} ry={15} rotate={10} fill={colors.teal} strokeWidth={1.2} />
        <G fill={colors.indigo}>
          {[
            [300, 150],
            [310, 142],
            [318, 154],
            [306, 162],
            [322, 168],
          ].map(([cx, cy]) => (
            <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={3.2} />
          ))}
        </G>
        <G fill={colors.teal}>
          {[
            [262, 120],
            [350, 130],
            [90, 250],
            [110, 270],
          ].map(([cx, cy]) => (
            <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={2} />
          ))}
        </G>
      </Svg>
      {children}
      {/* A soft wave instead of a straight edge, like the selvedge of a cloth. */}
      <Svg style={styles.wave} width={width} height={18} viewBox="0 0 390 18" preserveAspectRatio="none">
        <Path d="M0 8 C40 0 80 16 130 8 S220 0 260 8 S350 16 390 6 V18 H0 Z" fill={colors.shell} />
        <Path
          d="M0 8 C40 0 80 16 130 8 S220 0 260 8 S350 16 390 6"
          stroke={colors.indigo}
          strokeWidth={1.5}
          fill="none"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  // Tall enough to show the wax print even before a group is running.
  band: {
    minHeight: 220,
    backgroundColor: colors.mist,
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 34,
    gap: 18,
  },
  wave: { position: "absolute", left: 0, bottom: 0 },
});
