import type { RoundSummary } from "@novi/shared";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatDay, formatFcfa } from "../lib/format";
import { colors } from "../theme/colors";
import { PotJar } from "./art/PotJar";
import { fonts, type } from "../theme/typography";

// One round of the cycle: when it is due, whose turn it is, how much is in,
// and where the pot is once its day has come (Sprint 4). Saffron marks the member whose turn it is, and only that (colors.ts);
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
      <View style={styles.potRow}>
        <PotJar share={share} size={56} label={t("home.potCount", { paid: round.paidCount, size: round.size })} />
        <View style={styles.potText}>
          <Text style={styles.collected}>{formatFcfa(round.collectedFcfa)}</Text>
          <Text style={[type.small, styles.muted]}>
            {t("money.collected", {
              collected: formatFcfa(round.collectedFcfa),
              pot: formatFcfa(round.potFcfa),
              paid: round.paidCount,
              size: round.size,
            })}
          </Text>
        </View>
      </View>
      {round.payoutStatus === "PAID" && round.paidOutAt ? (
        <Text style={styles.paid}>
          {t("money.payoutPaid", { name: round.beneficiaryName, date: formatDay(round.paidOutAt) })}
        </Text>
      ) : round.payoutStatus === "HELD" ? (
        <Text style={styles.held}>{t("money.payoutHeld", { count: round.size - round.paidCount })}</Text>
      ) : round.payoutStatus !== "NOT_DUE" ? (
        <Text style={styles.label}>{t("money.payoutSending")}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 18, borderRadius: 20, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card },
  current: { borderColor: colors.action },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.muted },
  paid: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.paid },
  held: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.indigo },
  turn: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.yourTurn },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  potRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  potText: { flex: 1, gap: 2 },
  collected: { fontFamily: fonts.display, fontSize: 24, color: colors.indigo },
});
