import { useWindowDimensions } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors } from "../../theme/colors";
import { Cowrie } from "./Cowrie";

// A string of cowries, as they were threaded to count and carry money:
// orange, ivory and teal shells on a navy thread. Decoration only.
export function CowrieString({ margin = 24 }: { margin?: number }) {
  const { width: screen } = useWindowDimensions();
  const width = screen - margin * 2;
  const count = Math.max(3, Math.floor(width / 30));
  const step = width / count;
  const fills = [colors.accent, colors.shell, colors.teal];

  return (
    <Svg
      width={width}
      height={26}
      viewBox={`0 0 ${width} 26`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path d={`M0 13 H${width}`} stroke={colors.indigo} strokeWidth={1} />
      {Array.from({ length: count }, (_, i) => (
        <Cowrie
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative row
          key={i}
          cx={step * i + step / 2}
          cy={13}
          rx={6.5}
          ry={10}
          rotate={90}
          fill={fills[i % 3]}
          strokeWidth={1.1}
        />
      ))}
    </Svg>
  );
}
