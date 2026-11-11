import type { ReactNode } from "react";
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { colors } from "../theme/colors";

// D119: on a computer, Novi in a browser shows in a phone-wide column in the
// middle of the page, instead of stretching across the screen. On a phone
// (app or browser) it changes nothing: the column is as wide as the screen.
const COLUMN = 480;

// The width Novi has to draw in: the screen on a phone, the column on a
// computer. Screens that size things to the width use this, not the window.
export function useAppWidth(): { width: number; height: number } {
  const { width, height } = useWindowDimensions();
  return { width: Platform.OS === "web" ? Math.min(width, COLUMN) : width, height };
}

// A sheet rising from the bottom (a Modal covers the whole window): on a
// computer it rises inside the column too.
export const sheetColumn =
  Platform.OS === "web" ? ({ width: "100%", maxWidth: COLUMN, alignSelf: "center" } as const) : {};

export function WebFrame({ children }: { children: ReactNode }) {
  if (Platform.OS !== "web") return <>{children}</>;
  return (
    <View style={styles.page}>
      <View style={styles.column}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.indigo, alignItems: "center" },
  column: { flex: 1, width: "100%", maxWidth: COLUMN, overflow: "hidden", backgroundColor: colors.shell },
});
