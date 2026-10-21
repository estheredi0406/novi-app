import type { RoundSummary } from "@novi/shared";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatDay, formatFcfa } from "../lib/format";
import { colors } from "../theme/colors";
import { fonts, type } from "../theme/typography";

// One round of the cycle: when it is due, whose turn it is, and how much is
// in. Saffron marks the member whose turn it is, and only that (colors.ts);
// green marks only a payment that went through.
export function RoundCard({ round, onPress }: { round: RoundSummary; onPress: () => void }) {
  const { t } = useTranslation();
  const share = round.size > 0 ? round.paidCount / round.size : 0;

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.card, round.isCurrent && styles.current]}>
      <View style={styles.top}>
        <Text style={styles.label}>{t("money.roundTitle", { number: round.number, date: formatDay(round.dueDate) })}</Text>
        {round.myStatus === "PAID" ? <Text style={styles.paid}>{t("money.youPaid")}</Text> : null}
      </View>
      <View style={styles.turn}>
        <Text style={[type.body, styles.ink]}>{t("money.turnOf", { name: round.beneficiaryName })}</Text>
      </View>
      <Text style={[type.small, styles.muted]}>
        {t("money.collected", {
          collected: formatFcfa(round.collectedFcfa),
          pot: formatFcfa(round.potFcfa),
          paid: round.paidCount,
          size: round.size,
        })}
      </Text>
      <View style={styles.bar}>
        <View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8, padding: 18, borderRadius: 18, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.white },
  current: { borderColor: colors.action },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.muted },
  paid: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.paid },
  turn: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.yourTurn },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.mist, overflow: "hidden" },
  fill: { height: 8, backgroundColor: colors.paid },
});
