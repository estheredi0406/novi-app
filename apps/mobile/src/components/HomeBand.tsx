import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { colors } from "../theme/colors";

// Home's tall wax-print band (the approved "Home: wax" board): lavender
// crackle, orange and teal leaves, navy seed dots. The greeting and this
// week's card sit on it.
export function HomeBand({ children }: { children: ReactNode }) {
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
          <Path d="M70 60 L90 80 M160 150 L176 168 M250 90 L266 72 M330 200 L350 214 M60 230 L80 246 M200 290 L220 274" />
        </G>
        <G stroke={colors.indigo} strokeWidth={1.8} strokeLinejoin="round">
          <Path d="M250 -10 C330 0 380 60 372 140 C330 110 280 90 250 -10 Z" fill={colors.accent} />
          <Path d="M262 4 C300 40 330 80 360 128" strokeWidth={1.2} fill="none" />
          <Path d="M280 30 L300 26 M296 54 L318 50 M314 80 L336 78 M328 104 L350 104" strokeWidth={1.6} fill="none" />
          <Path d="M395 150 C340 170 300 230 320 300 C360 270 390 220 395 150 Z" fill={colors.accent} />
          <Path d="M388 166 C356 206 336 246 326 292" strokeWidth={1.2} fill="none" />
          <Path d="M-20 250 C40 230 100 260 120 330 C60 340 10 310 -20 250 Z" fill={colors.accent} />
          <Path d="M-6 258 C40 270 80 296 110 328" strokeWidth={1.2} fill="none" />
          <Path d="M200 236 C230 210 270 214 284 240 C260 262 226 262 200 236 Z" fill={colors.teal} />
          <Path d="M206 236 C236 236 260 238 280 240" strokeWidth={1.6} fill="none" />
        </G>
        <G fill={colors.indigo}>
          {[
            [318, 168],
            [328, 160],
            [336, 172],
            [324, 180],
            [340, 186],
            [312, 190],
            [330, 196],
            [346, 200],
          ].map(([cx, cy]) => (
            <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={3.4} />
          ))}
        </G>
        <G fill={colors.teal}>
          {[
            [300, 64],
            [316, 92],
            [336, 118],
            [350, 236],
            [40, 282],
            [70, 296],
          ].map(([cx, cy]) => (
            <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={2} />
          ))}
        </G>
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    backgroundColor: colors.mist,
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 18,
    gap: 18,
  },
});
