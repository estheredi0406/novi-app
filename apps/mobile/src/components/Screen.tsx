import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme/colors";

// The frame every screen sits in: keeps content clear of the phone's notch
// and home bar, on Novi's background, with the same side margins everywhere.
export function Screen({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <SafeAreaView style={[styles.safe, dark && styles.dark]}>
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.shell },
  dark: { backgroundColor: colors.indigo },
  content: { flex: 1, paddingHorizontal: 24, paddingVertical: 16, gap: 20 },
});