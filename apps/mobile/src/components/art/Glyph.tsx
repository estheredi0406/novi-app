import Svg, { Circle, Path } from "react-native-svg";
import { colors } from "../../theme/colors";

// The few small signs Novi uses, drawn for it in one style: round ends, a
// 2.5 stroke, on a 24 grid. No emoji, no icon pack.
type Name = "check" | "clock" | "turn" | "calendar" | "lock" | "chevron";

const PATHS: Record<Name, string> = {
  check: "M5 12.5 L10 17 L19 7",
  clock: "M12 7 V12 L15.5 14",
  turn: "M6 9 A7 7 0 0 1 18.5 8 M18.5 4 V8 H14.5 M18 15 A7 7 0 0 1 5.5 16 M5.5 20 V16 H9.5",
  calendar: "M5 7 H19 V19 H5 Z M5 11 H19 M9 4 V8 M15 4 V8",
  lock: "M7 11 H17 V19 H7 Z M9 11 V8 A3 3 0 0 1 15 8 V11",
  chevron: "M9 6 L15 12 L9 18",
};

export function Glyph({ name, color = colors.indigo, size = 20 }: { name: Name; color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {name === "clock" ? <Circle cx={12} cy={12} r={8} stroke={color} strokeWidth={2.5} fill="none" /> : null}
      <Path d={PATHS[name]} stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
