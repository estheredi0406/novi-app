import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

// A milestone she has reached (first payment, first pot, first full cycle),
// drawn as a round medallion with a cloth-like border. One not yet reached is
// shown as an outline, so she sees what comes next. Only she sees them.
const MARKS = {
  coin: "M20 26 H28 M24 22 V30",
  pot: "M19 21 H29 M18 24 C14 27 15 33 24 33 C33 33 34 27 30 24 Z",
  circle: "M24 17 A7 7 0 1 1 23.9 17 M24 14 V17",
} as const;

export function Badge({ mark, label, earned }: { mark: keyof typeof MARKS; label: string; earned: boolean }) {
  const ring = earned ? colors.laterite : colors.line;
  return (
    <View style={styles.badge} accessible accessibilityLabel={label} accessibilityState={{ disabled: !earned }}>
      <Svg width={56} height={56} viewBox="0 0 48 48">
        <G>
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * Math.PI) / 6;
            const x = 24 + Math.cos(a) * 20;
            const y = 24 + Math.sin(a) * 20;
            return <Circle key={i} cx={x} cy={y} r={2.6} fill={earned ? (i % 2 ? colors.yourTurn : ring) : colors.card} stroke={ring} strokeWidth={1} />;
          })}
        </G>
        <Circle cx={24} cy={24} r={15} fill={earned ? colors.indigo : colors.card} stroke={earned ? colors.indigo : colors.line} strokeWidth={2} />
        <Path d={MARKS[mark]} stroke={earned ? colors.onDark : colors.line} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
      <Text style={[styles.label, !earned && styles.locked]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: "center", gap: 6, width: 96 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.ink, textAlign: "center" },
  locked: { color: colors.muted },
});
