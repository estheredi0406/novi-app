import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { ListenButton } from "./ListenButton";

// The top row of the group screens: back to the previous screen, or home if
// there is none, and Listen.
export function BackHeader({ listenText }: { listenText: string }) {
  const { t } = useTranslation();

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("common.back")}
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))}
        style={styles.back}
      >
        <Text style={styles.backText}>‹</Text>
      </Pressable>
      <ListenButton text={listenText} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { width: 44, height: 44, justifyContent: "center" },
  backText: { fontSize: 36, lineHeight: 40, color: colors.indigo },
});
