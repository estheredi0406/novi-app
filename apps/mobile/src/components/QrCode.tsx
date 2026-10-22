import { create } from "qrcode";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "../theme/colors";

// Draws a QR code with plain views, one square per module, so no extra
// native library is needed (it runs in Expo Go). Medium error correction
// still reads when a corner of the screen is smudged or cracked.
export function QrCode({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const rows = useMemo(() => {
    const { modules } = create(value, { errorCorrectionLevel: "M" });
    return Array.from({ length: modules.size }, (_, row) =>
      Array.from({ length: modules.size }, (_, col) => modules.get(row, col) === 1),
    );
  }, [value]);

  // A white margin of 4 modules around the code, as the QR standard asks.
  const cell = size / (rows.length + 8);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={[styles.frame, { padding: cell * 4 }]}>
      {rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((dark, c) => (
            <View key={c} style={{ width: cell, height: cell, backgroundColor: dark ? colors.ink : colors.white }} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignSelf: "center", backgroundColor: colors.white, borderRadius: 12 },
  row: { flexDirection: "row" },
});
