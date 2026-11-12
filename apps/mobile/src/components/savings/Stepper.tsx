import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatFcfa } from "../../lib/format";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

// An amount chosen with − and + (D122, D123): no keyboard, no typing errors.
export function Stepper({
  value,
  min,
  max,
  step,
  onChange,
  caption,
  lessLabel,
  moreLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  caption?: string;
  lessLabel: string;
  moreLabel: string;
}) {
  const canLess = value - step >= min;
  const canMore = value + step <= max;
  return (
    <View style={styles.box}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={lessLabel}
        disabled={!canLess}
        onPress={() => onChange(Math.max(min, value - step))}
        style={[styles.round, !canLess && styles.off]}
      >
        <Text style={styles.sign}>−</Text>
      </Pressable>
      <View style={styles.middle}>
        <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
          {formatFcfa(value).replace(" FCFA", " F")}
        </Text>
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={moreLabel}
        disabled={!canMore}
        onPress={() => onChange(Math.min(max, value + step))}
        style={[styles.round, !canMore && styles.off]}
      >
        <Text style={styles.sign}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
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
  amount: { fontFamily: fonts.display, fontSize: 26, lineHeight: 34, color: colors.indigo },
  caption: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
});
