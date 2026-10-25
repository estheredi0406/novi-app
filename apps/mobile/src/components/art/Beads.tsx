import { View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import { colors } from "../../theme/colors";

// Her on-time streak as a string of beads: one bead filled for each payment
// on time in a row, up to eight, then the string is full. Beads rather than a
// number or a flame: a string that grows, like the beads traders wear.
export function Beads({ count, label }: { count: number; label: string }) {
  const total = 8;
  const filled = Math.min(count, total);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={total * 16 + 8} height={20}>
        <Line x1={4} y1={10} x2={total * 16 + 4} y2={10} stroke={colors.line} strokeWidth={2} />
        {Array.from({ length: total }, (_, i) => (
          <Circle
            key={i}
            cx={12 + i * 16}
            cy={10}
            r={6}
            fill={i < filled ? (i % 2 === 0 ? colors.laterite : colors.yourTurn) : colors.card}
            stroke={i < filled ? colors.indigo : colors.line}
            strokeWidth={1.5}
          />
        ))}
      </Svg>
    </View>
  );
}
