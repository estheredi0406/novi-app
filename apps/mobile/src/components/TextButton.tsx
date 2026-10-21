import { Pressable, StyleSheet, Text } from "react-native";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";

// A secondary action shown as a link, such as "Withdraw" or "Log out". Same
// 44-point touch target as every other control.
export function TextButton({
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
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  disabled: { opacity: 0.45 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.action },
});
