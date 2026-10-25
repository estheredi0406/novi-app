import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { colors } from "../../theme/colors";
import { PotJar } from "./PotJar";

// Shown once, when her payment has just gone through: three coins drop into
// the pot. A small moment of reward for saving, never a comparison with
// anyone else (UX direction, 23 Oct).
function Coin() {
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22">
      <Circle cx={11} cy={11} r={9} fill={colors.yourTurn} stroke={colors.indigo} strokeWidth={2} />
      <Path d="M7 11 H15" stroke={colors.indigo} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function Celebrate({ paid, label }: { paid: number; label: string }) {
  const drops = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.stagger(
      180,
      drops.map((value) => Animated.timing(value, { toValue: 1, duration: 650, useNativeDriver: true })),
    ).start();
  }, [drops]);

  return (
    <View style={styles.wrap} accessibilityLabel={label}>
      <View style={styles.coins}>
        {drops.map((value, i) => (
          <Animated.View
            key={i}
            style={{
              opacity: value.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
              transform: [
                { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [-40, 46] }) },
                { translateX: (i - 1) * 14 },
              ],
            }}
          >
            <Coin />
          </Animated.View>
        ))}
      </View>
      <PotJar paid={paid} size={96} label={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingTop: 24 },
  coins: { position: "absolute", top: 0, flexDirection: "row", zIndex: 1 },
});
