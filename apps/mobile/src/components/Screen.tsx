import { type ReactNode, useRef } from "react";
import { KeyboardAvoidingView, ScrollView, type ScrollViewInstance, StyleSheet, View } from "react-native";
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
  bleedTop = false,
  openAtEnd = false,
}: {
  children: ReactNode;
  dark?: boolean;
  top?: ReactNode;
  bar?: ReactNode;
  bleedTop?: boolean; // the top band draws under the status bar itself (LaguneBand)
  openAtEnd?: boolean; // D158: opens at its last part once its content is there
}) {
  const scroll = useRef<ScrollViewInstance>(null);
  const scrolled = useRef(false);
  const edges = [...(bleedTop ? [] : (["top"] as const)), "left", "right", ...(bar ? [] : (["bottom"] as const))] as const;
  return (
    // With a tab bar, the bar itself fills the space under it down to the
    // phone's edge, so the bottom stays white.
    <SafeAreaView style={[styles.safe, dark && styles.dark]} edges={edges}>
      {/* Keeps the field she is typing in above the keyboard. On Android too:
          the app is edge-to-edge, so the window no longer shrinks for the
          keyboard by itself (Expo's keyboard guide). */}
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <ScrollView
          ref={scroll}
          onContentSizeChange={() => {
            if (!openAtEnd || scrolled.current) return;
            scrolled.current = true;
            setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 300);
          }}
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
  content: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 20, gap: 28 },
});
