import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Rect } from "react-native-svg";
import { colors } from "../../theme/colors";

// The pot of a round: a clay jar (canari) with an orange lid, holding one
// coin per member who has paid this round. Grey coins while a payout is held.
const JAR =
  "M30 14 H62 V22 C62 25 59 26 59 29 C78 36 86 52 86 66 C86 88 68 100 46 100 C24 100 6 88 6 66 C6 52 14 36 33 29 C33 26 30 25 30 22 Z";
// Where coins land, from the bottom of the jar upwards.
const COINS: [number, number][] = [
  [36, 93],
  [58, 94],
  [46, 88],
  [40, 83],
  [56, 82],
  [46, 77],
  [36, 72],
  [56, 71],
];

export function PotJar({
  paid,
  size = 78,
  tone = "paid",
  label,
}: {
  paid: number; // members who have paid this round
  size?: number;
  tone?: "paid" | "held";
  label: string;
}) {
  const shown = Math.max(0, Math.min(COINS.length, paid));
  const deep = tone === "held" ? colors.crackle : colors.goldDeep;
  const light = tone === "held" ? colors.line : colors.gold;

  return (
    <Svg
      width={size}
      height={(size * 104) / 92}
      viewBox="0 0 92 104"
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      <Defs>
        <ClipPath id="jar">
          <Path d={JAR} />
        </ClipPath>
      </Defs>
      <Path d={JAR} fill={colors.white} />
      <G clipPath="url(#jar)">
        {COINS.slice(0, shown).map(([cx, cy], i) => (
          <Ellipse
            key={`${cx}-${cy}`}
            cx={cx}
            cy={cy}
            rx={13}
            ry={4.5}
            fill={i % 3 === 2 ? light : deep}
            stroke={colors.indigo}
            strokeWidth={1.4}
          />
        ))}
        <G fill={colors.indigo}>
          <Circle cx={30} cy={56} r={2.5} />
          <Circle cx={40} cy={52} r={2.5} />
          <Circle cx={50} cy={56} r={2.5} />
          <Circle cx={60} cy={52} r={2.5} />
        </G>
      </G>
      <Path d={JAR} fill="none" stroke={colors.indigo} strokeWidth={2.6} strokeLinejoin="round" />
      <Rect x={24} y={7} width={44} height={9} rx={4.5} fill={colors.accent} stroke={colors.indigo} strokeWidth={2} />
    </Svg>
  );
}
