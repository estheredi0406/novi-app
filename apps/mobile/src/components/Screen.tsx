import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
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
    // With a tab bar, the bar itself fills the space under it down to the
    // phone's edge, so the bottom stays white.
    <SafeAreaView style={[styles.safe, dark && styles.dark]} edges={bar ? ["top", "left", "right"] : undefined}>
      {/* Keeps the field she is typing in above the keyboard. */}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          {top}
          <View style={styles.content}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
      {bar}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.shell },
  dark: { backgroundColor: colors.indigo },
  fill: { flex: 1 },
  scroll: { flexGrow: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 16, gap: 20 },
});
