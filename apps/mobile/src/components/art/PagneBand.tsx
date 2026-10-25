import { View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { colors } from "../../theme/colors";

// A strip in the spirit of a wax-print border, drawn for Novi. Each group gets
// its own pattern and colours from its ID, so a member recognises her group at
// a glance, as she would recognise a cloth. Decoration only: it carries no
// meaning, so it uses none of the colours reserved for paid, problem or turn.
const PALETTES = [
  [colors.indigo, colors.laterite, "#E9C46A"],
  [colors.laterite, colors.indigo, colors.card],
  ["#2F5D50", "#E9C46A", colors.indigo],
  [colors.indigo, "#E9C46A", colors.laterite],
] as const;

function seedOf(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

export function PagneBand({ seed, height = 14 }: { seed: string; height?: number }) {
  const n = seedOf(seed);
  const [base, accent, dot] = PALETTES[n % PALETTES.length] ?? PALETTES[0];
  const motif = n % 3; // zigzag, diamonds or arches
  const w = height * 1.5;
  const shapes = Array.from({ length: 40 }, (_, i) => {
    const x = i * w;
    if (motif === 0) return <Path key={i} d={`M${x} ${height} L${x + w / 2} 2 L${x + w} ${height} Z`} fill={accent} />;
    if (motif === 1)
      return <Path key={i} d={`M${x + w / 2} 2 L${x + w - 2} ${height / 2} L${x + w / 2} ${height - 2} L${x + 2} ${height / 2} Z`} fill={accent} />;
    return <Path key={i} d={`M${x + 2} ${height} A${w / 2 - 2} ${height - 4} 0 0 1 ${x + w - 2} ${height} Z`} fill={accent} />;
  });
  const dots = Array.from({ length: 40 }, (_, i) => (
    <Rect key={`d${i}`} x={i * w + w / 2 - 1.5} y={height / 2 - 1.5} width={3} height={3} fill={dot} />
  ));

  return (
    <View style={{ height, overflow: "hidden" }} accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width={40 * w} height={height}>
        <Rect x={0} y={0} width={40 * w} height={height} fill={base} />
        {shapes}
        {motif !== 2 ? dots : null}
      </Svg>
    </View>
  );
}
