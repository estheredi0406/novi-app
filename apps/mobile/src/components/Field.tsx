import { StyleSheet, Text, TextInput, type TextInputProps, View } from "react-native";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";

// A labelled text input. The optional prefix shows fixed text before the
// input, such as +228 before a phone number.
export function Field({ label, prefix, style, ...input }: { label: string; prefix?: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.box}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
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
  input: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 22, color: colors.ink, paddingVertical: 12 },
});