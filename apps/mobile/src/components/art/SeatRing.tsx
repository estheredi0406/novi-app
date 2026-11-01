import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { colors } from "../../theme/colors";

// The ring of members (D92): one segment per seat, in turn order, starting at
// the top. Green when that member has paid this round, pale when not, orange
// for her own seat while she still owes. Outside the ring, a saffron dot marks
// the member who receives this round's pot and a small orange dot marks her
// seat. Whatever is passed as children sits in the middle.
export function SeatRing({
  paid,
  mine,
  receiver,
  size = 148,
  children,
}: {
  paid: readonly boolean[];
  mine?: number | null; // her seat, from 0
  receiver?: number | null; // the receiver's seat, from 0
  size?: number;
  children?: ReactNode;
}) {
  const n = Math.max(paid.length, 1);
  const c = size / 2;
  const r = size / 2 - 16;
  const gap = n <= 12 ? 7 : 4; // degrees between segments
  const at = (deg: number, radius: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: c + radius * Math.cos(a), y: c + radius * Math.sin(a) };
  };

  const segments = paid.map((isPaid, i) => {
    const a0 = -90 + (i * 360) / n + gap / 2;
    const a1 = -90 + ((i + 1) * 360) / n - gap / 2;
    const p0 = at(a0, r);
    const p1 = at(a1, r);
    const large = a1 - a0 > 180 ? 1 : 0;
    const color = isPaid ? colors.paid : i === mine ? colors.accent : colors.seatEmpty;
    const mid = at((a0 + a1) / 2, r + 11);
    return { d: `M${p0.x} ${p0.y} A${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`, color, mid, i };
  });

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {segments.map((s) => (
          <Path key={s.i} d={s.d} stroke={s.color} strokeWidth={10} strokeLinecap="round" fill="none" />
        ))}
        {segments.map((s) =>
          s.i === receiver ? (
            <Circle key={`r${s.i}`} cx={s.mid.x} cy={s.mid.y} r={6} fill={colors.yourTurn} stroke={colors.white} strokeWidth={2} />
          ) : s.i === mine ? (
            <Circle
              key={`m${s.i}`}
              cx={s.mid.x}
              cy={s.mid.y}
              r={5.5}
              fill={paid[s.i] ? colors.white : colors.accent}
              stroke={paid[s.i] ? colors.accent : colors.white}
              strokeWidth={2.5}
            />
          ) : null,
        )}
      </Svg>
      <View style={styles.middle}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  middle: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
});
