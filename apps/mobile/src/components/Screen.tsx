import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme/colors";

// The frame every screen sits in: keeps content clear of the notch and home
// bar, scrolls on small phones or when the keyboard is open, and uses the same
// margins everywhere. "top" is a full-width band above the content (home,
// record, me); "bar" stays fixed at the bottom (the tab bar).
export function Screen({
  children,
  dark = false,
  top,
  bar,
}: {
  children: ReactNode;
  dark?: boolean;
  top?: ReactNode;
  bar?: ReactNode;
}) {
  return (
    <SafeAreaView style={[styles.safe, dark && styles.dark]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {top}
        <View style={styles.content}>{children}</View>
      </ScrollView>
      {bar}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.shell },
  dark: { backgroundColor: colors.indigo },
  scroll: { flexGrow: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 16, gap: 20 },
});
