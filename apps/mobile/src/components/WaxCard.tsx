import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { colors } from "../theme/colors";

// A card (direction "Lagune", D92): white, a soft blue shadow, no outline,
// like the cards of a bank app. The name stays from the wax-print direction
// so every screen that used it follows.
export function WaxCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    backgroundColor: colors.card,
    elevation: 3,
    shadowColor: colors.indigo,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
});
