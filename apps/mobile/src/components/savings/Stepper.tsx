import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { formatFcfa } from "../../lib/format";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

// An amount chosen with − and + or typed (D122, D123, D125). The parent decides
// what is allowed; out of range, the box turns red and the hint gives the range.
const digits = (s: string) => s.replace(/\D/g, "").slice(0, 8);
const spaced = (n: number) => formatFcfa(n).replace(" FCFA", "");

export function Stepper({
  value,
  min,
  max,
  step,
  onChange,
  caption,
  lessLabel,
  moreLabel,
  inputLabel,
  rangeHint,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  caption?: string;
  lessLabel: string;
  moreLabel: string;
  inputLabel?: string;
  rangeHint?: string; // shown when the amount is out of bounds
}) {
  const [text, setText] = useState(value > 0 ? spaced(value) : "");
  const [editing, setEditing] = useState(false);
  // − and + change the value from outside: show it, unless she is typing.
  useEffect(() => {
    if (!editing) setText(value > 0 ? spaced(value) : "");
  }, [value, editing]);

  const bad = value < min || value > max;
  const canLess = value - step >= min;
  const canMore = value + step <= max;
  // From an amount she typed (say 7 250), − and + land on the step's grid.
  const less = () => onChange(Math.max(min, Math.ceil(value / step) * step - step));
  const more = () => onChange(Math.min(max, Math.floor(value / step) * step + step));

  return (
    <View style={styles.wrap}>
      <View style={[styles.box, bad && value > 0 && styles.boxBad]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={lessLabel}
          disabled={!canLess}
          onPress={less}
          style={[styles.round, !canLess && styles.off]}
        >
          <Text style={styles.sign}>−</Text>
        </Pressable>
        <View style={styles.middle}>
          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={(s) => {
                const d = digits(s);
                const n = d ? Number(d) : 0;
                setText(d ? spaced(n) : "");
                onChange(n);
              }}
              onFocus={() => setEditing(true)}
              onBlur={() => setEditing(false)}
              keyboardType="number-pad"
              inputMode="numeric"
              returnKeyType="done"
              placeholder="0"
              placeholderTextColor={colors.muted}
              accessibilityLabel={inputLabel ?? caption}
              selectTextOnFocus
              style={styles.amount}
            />
            <Text style={styles.unit}>F</Text>
          </View>
          {caption ? <Text style={styles.caption}>{caption}</Text> : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={moreLabel}
          disabled={!canMore}
          onPress={more}
          style={[styles.round, !canMore && styles.off]}
        >
          <Text style={styles.sign}>+</Text>
        </Pressable>
      </View>
      {bad && rangeHint ? (
        <Text style={[styles.hint, value > 0 && styles.hintBad]} accessibilityLiveRegion="polite">
          {rangeHint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  boxBad: { borderWidth: 2, borderColor: colors.problem },
  round: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.action,
    alignItems: "center",
    justifyContent: "center",
  },
  off: { borderColor: colors.line, opacity: 0.5 },
  sign: { fontFamily: fonts.bodyBold, fontSize: 24, lineHeight: 28, color: colors.action },
  middle: { flex: 1, alignItems: "center" },
  inputRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: 4 },
  amount: {
    minWidth: 60,
    maxWidth: 140,
    borderWidth: 0,
    outlineWidth: 0,
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderBottomWidth: 2,
    borderBottomColor: colors.action,
    textAlign: "center",
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 34,
    color: colors.indigo,
  },
  unit: { fontFamily: fonts.display, fontSize: 22, lineHeight: 34, color: colors.indigo },
  caption: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 2 },
  hint: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted, textAlign: "center" },
  hintBad: { color: colors.problem },
});
