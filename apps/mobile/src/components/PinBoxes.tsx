import { type ComponentRef, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";

// The PIN as four boxes, as in most apps: a dot for each digit typed, the
// next box outlined in orange. The digits are never shown. The keyboard
// belongs to one hidden field; tapping the boxes brings it back.
export function PinBoxes({
  label,
  value,
  onChangeText,
  editable = true,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  editable?: boolean;
  autoFocus?: boolean;
}) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  // A new step (create, then confirm) starts with the keyboard open.
  useEffect(() => {
    if (autoFocus) setTimeout(() => input.current?.focus(), 150);
  }, [autoFocus]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        onPress={() => input.current?.focus()}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value.length} / 4`}
        style={styles.row}
      >
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.box, focused && i === Math.min(value.length, 3) && styles.boxActive]}>
            <Text style={styles.dot}>{i < value.length ? "•" : ""}</Text>
          </View>
        ))}
      </Pressable>
      <TextInput
        ref={input}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={4}
        editable={editable}
        caretHidden
        style={styles.hidden}
        importantForAutofill="no"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  row: { flexDirection: "row", gap: 12 },
  box: {
    flex: 1,
    height: 64,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  boxActive: { borderWidth: 2.5, borderColor: colors.accent },
  dot: { fontFamily: fonts.bodyBold, fontSize: 30, color: colors.ink },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
