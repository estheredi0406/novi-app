import Svg, { Ellipse, Path } from "react-native-svg";
import { colors } from "../../theme/colors";

// The pot of a round: a clay jar (canari) with one coin per member who has
// paid, stacked from the bottom. Empty places are dotted outlines, so she can
// count at a glance who is still missing. A held payout shows grey coins.
const JAR =
  "M18 6 H46 V12 C46 14 44 15 44 17 C56 22 60 34 60 46 C60 62 48 72 32 72 C16 72 4 62 4 46 C4 34 8 22 20 17 C20 15 18 14 18 12 Z";

export function PotJar({
  share,
  slots = 6,
  size = 72,
  tone = "paid",
  label,
}: {
  share: number; // 0 to 1
  slots?: number; // coins when full (the group size, up to 8)
  size?: number;
  tone?: "paid" | "held" | "turn";
  label: string;
}) {
  const places = Math.max(1, Math.min(8, slots));
  const filled = Math.round(Math.max(0, Math.min(1, share)) * places);
  const face = tone === "held" ? colors.line : colors.gold;
  const edge = tone === "held" ? colors.crackle : colors.goldDeep;
  // Coins stack from y=64 upwards inside the jar's body (y 22 to 70).
  const step = Math.min(6, 40 / places);

  return (
    <Svg
      width={size}
      height={(size * 76) / 64}
      viewBox="0 0 64 76"
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      <Path d={JAR} fill={tone === "turn" ? colors.mist : colors.card} />
      {Array.from({ length: places }, (_, i) => {
        const y = 64 - i * step;
        return i < filled ? (
          <Ellipse key={i} cx={32} cy={y} rx={15} ry={4.5} fill={face} stroke={edge} strokeWidth={1.2} />
        ) : (
          <Ellipse
            key={i}
            cx={32}
            cy={y}
            rx={15}
            ry={4.5}
            fill="none"
            stroke={colors.crackle}
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        );
      })}
      <Path d={JAR} fill="none" stroke={colors.indigo} strokeWidth={1.8} strokeLinejoin="round" />
      <Path d="M16 6 H48" stroke={colors.indigo} strokeWidth={3} strokeLinecap="round" />
    </Svg>
  );
}
