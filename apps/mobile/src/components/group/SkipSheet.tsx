import type { GroupDetail, RoundSummary } from "@novi/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { errorKey } from "../../api/client";
import { skipRound } from "../../api/money";
import { formatFcfa, shortDay } from "../../lib/format";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";
import { ErrorMessage } from "../ErrorMessage";

const DAY_MS = 24 * 60 * 60 * 1000;

// D104: "Je ne peux pas payer ce tour". Before she confirms, the sheet says
// what happens: who pays her share now (her advance first, then the group's),
// how much she repays and by when, and that it is not counted as late.
export function SkipSheet({
  visible,
  group,
  round,
  next,
  onClose,
  onDone,
}: {
  visible: boolean;
  group: GroupDetail;
  round: RoundSummary;
  next: RoundSummary | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = group.rules.amountFcfa;
  const mine = Math.min(group.reserve?.mine?.nowFcfa ?? 0, amount);
  // The same deadline the API sets: 7 days, or the next turn if later.
  const week = Date.now() + 7 * DAY_MS;
  const nextDue = next ? new Date(`${next.dueDate}T00:00:00Z`).getTime() : 0;
  const dueBy = new Date(Math.max(week, nextDue)).toISOString().slice(0, 10);
  const left = (group.reserve?.mine?.skipsLeft ?? 1) - 1;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await skipRound(group.id, round.number);
      onDone();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t("skip.cancel")} />
      <SafeAreaView edges={["bottom"]} style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.kicker}>
          {group.name} · {t("groupView.roundOf", { number: round.number, total: group.rules.size })}
        </Text>
        <Text style={styles.title}>{t("skip.title", { amount: formatFcfa(amount).replace(" FCFA", " F") })}</Text>
        <View style={styles.box}>
          <View style={styles.row}>
            <Text style={styles.label}>{t("skip.yourAdvance")}</Text>
            <Text style={styles.value}>{formatFcfa(mine)}</Text>
          </View>
          <View style={[styles.row, styles.line]}>
            <Text style={styles.label}>{t("skip.groupAdvances")}</Text>
            <Text style={styles.value}>{formatFcfa(amount - mine)}</Text>
          </View>
        </View>
        <View style={styles.owe}>
          <Text style={styles.oweText}>{t("skip.repayBy", { date: shortDay(dueBy, i18n.language) })}</Text>
          <Text style={styles.oweAmount}>{formatFcfa(amount).replace(" FCFA", " F")}</Text>
        </View>
        <Text style={styles.note}>✓ {t("skip.notLate")}</Text>
        <Text style={styles.note}>{left > 0 ? t("skip.left", { count: left }) : t("skip.last")}</Text>
        <ErrorMessage messageKey={error} />
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void confirm()}
          style={[styles.confirm, busy && styles.busy]}
        >
          <Text style={styles.confirmText}>{t("skip.confirm")}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancel}>
          <Text style={styles.cancelText}>{t("skip.cancel")}</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(6,41,74,0.45)" },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 14,
  },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line },
  kicker: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.indigo },
  box: { backgroundColor: colors.shell, borderRadius: 16, paddingHorizontal: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12 },
  line: { borderTopWidth: 1, borderTopColor: colors.line },
  label: { fontFamily: fonts.body, fontSize: 16, color: colors.ink },
  value: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  owe: {
    backgroundColor: "#FDF1DC",
    borderRadius: 16,
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  oweText: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 15, color: "#8A5A00" },
  oweAmount: { fontFamily: fonts.display, fontSize: 24, color: "#8A5A00" },
  note: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink },
  confirm: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: colors.lagoon,
    alignItems: "center",
    justifyContent: "center",
  },
  busy: { opacity: 0.5 },
  confirmText: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.white },
  cancel: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  cancelText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.lagoon },
});
