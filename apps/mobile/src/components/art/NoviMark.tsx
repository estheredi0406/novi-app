import Svg from "react-native-svg";
import { colors } from "../../theme/colors";
import { Cowrie } from "./Cowrie";

// Novi's mark: three cowries fanned out, orange, ivory and teal, as a small
// hand of shells, the old money of West Africa. Used on the splash screen
// and at the top of sign-up and login. On the orange splash, the orange
// shell becomes gold, the colour of the coins in the pot.
export function NoviMark({ size = 96, onOrange = false }: { size?: number; onOrange?: boolean }) {
  return (
    <Svg width={size} height={size * 0.72} viewBox="0 0 120 86" accessibilityElementsHidden>
      <Cowrie cx={34} cy={46} rx={17} ry={27} rotate={-28} fill={onOrange ? colors.gold : colors.accent} strokeWidth={2} />
      <Cowrie cx={86} cy={46} rx={17} ry={27} rotate={28} fill={colors.teal} strokeWidth={2} />
      <Cowrie cx={60} cy={40} rx={18} ry={29} fill={colors.shell} strokeWidth={2} />
    </Svg>
  );
}
