import { type ComponentRef, useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Svg from "react-native-svg";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { Cowrie } from "./art/Cowrie";

// The PIN as four cowries that turn orange one by one as she types: she sees
// how many digits she has entered, never the digits. The keyboard belongs to
// a hidden field; tapping the shells brings it back.
export function PinCowries({
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
          <Svg key={i} width={46} height={62} viewBox="0 0 46 62">
            <Cowrie
              cx={23}
              cy={31}
              rx={14}
              ry={24}
              fill={i < value.length ? colors.accent : colors.card}
              strokeWidth={1.8}
            />
          </Svg>
        ))}
      </Pressable>
      <TextInput
        ref={input}
        value={value}
        onChangeText={onChangeText}
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
  wrap: { gap: 12, alignItems: "center" },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink, alignSelf: "flex-start" },
  row: {
    flexDirection: "row",
    gap: 18,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.mist,
  },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
