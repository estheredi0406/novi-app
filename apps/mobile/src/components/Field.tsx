import type { ComponentRef, Ref } from "react";
import { Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from "react-native";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";

// A labelled text input. The optional prefix shows fixed text before the
// input, such as +228 before a phone number. With onPrefixPress, the prefix
// is a button (on the pilot: +228 or +250, D111).
export function Field({
  label,
  prefix,
  onPrefixPress,
  style,
  ref,
  ...input
}: {
  label: string;
  prefix?: string;
  onPrefixPress?: () => void;
  ref?: Ref<ComponentRef<typeof TextInput>>;
} & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.box}>
        {prefix && onPrefixPress ? (
          <Pressable accessibilityRole="button" accessibilityLabel={prefix} onPress={onPrefixPress} hitSlop={8}>
            <Text style={[styles.prefix, styles.prefixButton]}>{prefix} ▾</Text>
          </Pressable>
        ) : prefix ? (
          <Text style={styles.prefix}>{prefix}</Text>
        ) : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.muted}
          style={[styles.input, style]}
          {...input}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  box: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 60,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    minWidth: 0,
  },
  prefix: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 20,
    color: colors.muted,
    paddingRight: 12,
    marginRight: 12,
    borderRightWidth: 1.5,
    borderRightColor: colors.line,
  },
  prefixButton: { color: colors.lagoon },
  // D132: minWidth 0 lets the box shrink to its frame. In a browser an input
  // keeps a width of its own (about 20 characters), so the day, month and
  // year boxes were wider than their frames and the screen slid sideways when
  // she tapped the year.
  input: { flex: 1, minWidth: 0, fontFamily: fonts.bodySemiBold, fontSize: 22, color: colors.ink, paddingVertical: 12 },
});
