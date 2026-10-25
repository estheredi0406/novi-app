import { Pressable, StyleSheet, Text } from "react-native";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";

// The main action on a screen. At least 56 points tall, well above the
// 44-point minimum for touch targets, for use with one hand or a thumb.
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  pressed: { backgroundColor: colors.indigo },
  disabled: { opacity: 0.45 },
  label: { color: colors.white, fontFamily: fonts.bodyBold, fontSize: 17 },
});