import { Pressable, StyleSheet, Text } from "react-native";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";

// One choice among several, such as a neighbourhood or a market.
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.selected]}
    >
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.white,
    justifyContent: "center",
  },
  selected: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  labelSelected: { color: colors.onDark },
});