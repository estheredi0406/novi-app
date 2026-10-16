import type { ReactNode } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme/colors";

// The frame every screen sits in: keeps content clear of the notch and home
// bar, scrolls on small phones or when the keyboard is open, and uses the same
// margins everywhere.
export function Screen({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <SafeAreaView style={[styles.safe, dark && styles.dark]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.shell },
  dark: { backgroundColor: colors.indigo },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 16, gap: 20 },
});