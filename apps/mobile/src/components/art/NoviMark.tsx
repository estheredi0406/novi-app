import Svg from "react-native-svg";
import { colors } from "../../theme/colors";
import { Cowrie } from "./Cowrie";

// Novi's mark: three cowries, orange, ivory and teal. On the orange splash the
// orange one turns gold.
export function NoviMark({ size = 96, onOrange = false }: { size?: number; onOrange?: boolean }) {
  return (
    <Svg width={size} height={size * 0.72} viewBox="0 0 120 86" accessibilityElementsHidden>
      <Cowrie cx={34} cy={46} rx={17} ry={27} rotate={-28} fill={onOrange ? colors.gold : colors.accent} strokeWidth={2} />
      <Cowrie cx={86} cy={46} rx={17} ry={27} rotate={28} fill={colors.teal} strokeWidth={2} />
      <Cowrie cx={60} cy={40} rx={18} ry={29} fill={colors.shell} strokeWidth={2} />
    </Svg>
  );
}
