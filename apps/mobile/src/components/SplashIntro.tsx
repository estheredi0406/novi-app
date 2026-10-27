import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import Svg, { G, Path } from "react-native-svg";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { NoviMark } from "./art/NoviMark";

// The opening screen: on the orange of Novi's icon, its three cowries and
// its name in white, as on the
// phone's own splash, then a short line about what Novi is. It plays once per
// launch, about a second and a half, then fades into the app behind it.
export function SplashIntro({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const mark = useRef(new Animated.Value(0)).current;
  const words = useRef(new Animated.Value(0)).current;
  const whole = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const run = Animated.sequence([
      Animated.spring(mark, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }),
      Animated.timing(words, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(650),
      Animated.timing(whole, { toValue: 0, duration: 320, useNativeDriver: true }),
    ]);
    run.start(({ finished }) => finished && onDone());
    return () => run.stop();
  }, [mark, words, whole, onDone]);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.screen, { opacity: whole }]} pointerEvents="none">
      {/* The crackle of a wax print, faint on orange. */}
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice">
        <G stroke="#F47B45" strokeWidth={1.6} fill="none">
          <Path d="M0 120 C60 100 110 150 170 120 S270 90 330 128 S380 140 400 120" />
          <Path d="M0 700 C50 680 110 730 170 700 S260 660 320 702 S380 720 400 700" />
          <Path d="M80 0 C95 120 60 260 90 400 S110 640 80 844" />
          <Path d="M300 0 C285 140 320 300 295 450 S280 700 305 844" />
        </G>
      </Svg>
      <View style={styles.center}>
        <Animated.View
          style={{
            opacity: mark,
            transform: [{ scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          }}
        >
          <NoviMark size={132} onOrange />
        </Animated.View>
        <Animated.View
          style={{
            alignItems: "center",
            opacity: words,
            transform: [{ translateY: words.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
          }}
        >
          <Text style={styles.word}>Novi</Text>
          <Text style={styles.line}>{t("splash.tagline")}</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.accent, zIndex: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, paddingHorizontal: 32 },
  word: { fontFamily: fonts.display, fontSize: 56, lineHeight: 64, color: colors.white, letterSpacing: 1 },
  line: { fontFamily: fonts.bodySemiBold, fontSize: 17, color: colors.white, textAlign: "center", marginTop: 6 },
});
