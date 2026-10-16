import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { ListenButton } from "./ListenButton";

const SIGN_UP_STEPS = 6;

// The top row of every sign-up screen: back, progress dots, Listen.
export function StepHeader({ step, listenText }: { step?: number; listenText: string }) {
  const { t } = useTranslation();

  return (
    <View style={styles.row}>
      {router.canGoBack() ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          onPress={() => router.back()}
          style={styles.back}
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>
      ) : (
        <View style={styles.back} />
      )}

      {step ? (
        <View style={styles.dots} accessible accessibilityLabel={`${step} / ${SIGN_UP_STEPS}`}>
          {Array.from({ length: SIGN_UP_STEPS }, (_, i) => (
            <View key={i} style={[styles.dot, i < step && styles.dotDone]} />
          ))}
        </View>
      ) : (
        <View />
      )}

      <ListenButton text={listenText} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { width: 44, height: 44, justifyContent: "center" },
  backText: { fontSize: 36, lineHeight: 40, color: colors.indigo },
  dots: { flexDirection: "row", gap: 6 },
  dot: { width: 20, height: 6, borderRadius: 3, backgroundColor: colors.line },
  dotDone: { backgroundColor: colors.action },
});