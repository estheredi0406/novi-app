import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "../theme/colors";

// The light band at the top of secondary screens (D92), so the blue pagne band
// stays for the main screens.
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
