import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";

// A tickable agreement. The whole row is the touch target, not just the box.
export function CheckRow({
  checked,
  onToggle,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={styles.row}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked ? <Text style={styles.tick}>✓</Text> : null}
      </View>
      <Text style={styles.text}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 14, alignItems: "flex-start", paddingVertical: 6 },
  box: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: { backgroundColor: colors.action, borderColor: colors.action },
  tick: { color: colors.white, fontFamily: fonts.bodyBold, fontSize: 16 },
  text: { flex: 1, fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.ink },
});