import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "../theme/colors";

// The soft sky band at the top of the secondary screens (Mon compte, the
// meetings, a group still being set up), direction "Lagune" (D92): flat,
// no outline, rounded at the bottom, so the blue pagne band stays for the
// main screens.
export function HeaderBand({ children }: { children: ReactNode }) {
  return (
    <View style={styles.band}>
      <View style={styles.inner}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: { backgroundColor: colors.mist, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  inner: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, gap: 6 },
});
