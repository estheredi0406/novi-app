import { useEffect, useRef } from "react";
import { Animated } from "react-native";
import Svg, { ClipPath, Defs, Path, Rect } from "react-native-svg";
import { colors } from "../../theme/colors";

// The pot of a round, drawn as a clay jar (canari) that fills as members pay.
// Green fill only once money has arrived (colors.ts); the empty part stays
// cotton. The fill rises gently when the share changes.
const AnimatedRect = Animated.createAnimatedComponent(Rect);

const JAR = "M18 6 H46 V12 C46 14 44 15 44 17 C56 22 60 34 60 46 C60 62 48 72 32 72 C16 72 4 62 4 46 C4 34 8 22 20 17 C20 15 18 14 18 12 Z";

export function PotJar({
  share,
  size = 64,
  tone = "paid",
  label,
}: {
  share: number; // 0 to 1
  size?: number;
  tone?: "paid" | "held" | "turn";
  label: string;
}) {
  const level = useRef(new Animated.Value(0)).current;
  const fill = tone === "held" ? colors.mist : tone === "turn" ? colors.yourTurn : colors.paid;

  useEffect(() => {
    Animated.timing(level, { toValue: Math.max(0, Math.min(1, share)), duration: 700, useNativeDriver: false }).start();
  }, [share, level]);

  // The jar's body runs from y=17 to y=72: the fill rises inside it.
  const y = level.interpolate({ inputRange: [0, 1], outputRange: [72, 14] });

  return (
    <Svg width={size} height={(size * 76) / 64} viewBox="0 0 64 76" accessibilityRole="image" accessibilityLabel={label}>
      <Defs>
        <ClipPath id="jar">
          <Path d={JAR} />
        </ClipPath>
      </Defs>
      <Path d={JAR} fill={colors.card} />
      <AnimatedRect x={0} y={y} width={64} height={76} fill={fill} clipPath="url(#jar)" />
      <Path d="M10 40 C22 44 42 44 54 40" stroke={colors.laterite} strokeWidth={1.5} fill="none" opacity={0.5} />
      <Path d={JAR} fill="none" stroke={colors.indigo} strokeWidth={3} strokeLinejoin="round" />
      <Rect x={16} y={3} width={32} height={5} rx={2.5} fill={colors.indigo} />
    </Svg>
  );
}
