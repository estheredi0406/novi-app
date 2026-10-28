import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { ListenButton } from "./ListenButton";

// A sheet that rises from the bottom: where an explanation lives, so the
// screens themselves show only amounts, dates, names and buttons. "?" opens
// one; "Compris" or a tap outside closes it.
export function Sheet({
  visible,
  title,
  listenText,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  listenText: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t("common.close")} />
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.head}>
          <Text style={styles.title}>{title}</Text>
          <ListenButton text={listenText} />
        </View>
        {children}
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.done}>
          <Text style={styles.doneText}>{t("common.understood")}</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

// The small round "?" that opens a sheet.
export function HelpDot({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={10} style={styles.dot}>
      <Text style={styles.dotText}>?</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(27,31,75,0.55)" },
  sheet: {
    backgroundColor: colors.shell,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1.5,
    borderColor: colors.indigo,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 20,
    gap: 16,
  },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: colors.crackle },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { flex: 1, fontFamily: fonts.display, fontSize: 24, color: colors.indigo },
  done: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  doneText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.indigo },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  dotText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.indigo },
});
