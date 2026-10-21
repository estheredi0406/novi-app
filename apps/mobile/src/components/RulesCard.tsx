import type { GroupRules } from "@novi/shared";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { formatFcfa } from "../lib/format";
import { scheduleText } from "../lib/rulesText";
import { colors } from "../theme/colors";
import { fonts, type } from "../theme/typography";

// A group's rules, as she reads them before answering and on the group page.
// The pot and the MFI holding the money are always shown, so she knows how
// much each turn brings and where the money sits (D34).
export function RulesCard({ rules, mfiName }: { rules: GroupRules; mfiName: string }) {
  const { t } = useTranslation();
  const pot = rules.amountFcfa * rules.size;

  const rows: [string, string][] = [
    [t("rules.contribution"), `${formatFcfa(rules.amountFcfa)} ${scheduleText(t, rules.frequency, rules.dueDay)}`],
    [t("rules.size"), t("rules.members", { count: rules.size })],
    [t("rules.pot"), formatFcfa(pot)],
    [t("rules.order"), rules.payoutOrder === "DRAWN" ? t("rules.orderDrawn") : t("rules.orderFixed")],
    [t("rules.heldAt"), mfiName],
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.version}>{t("rules.version", { version: rules.version })}</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <Text style={[type.body, styles.value]}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 18, borderRadius: 18, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.white },
  version: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.muted },
  row: { gap: 2 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.muted },
  value: { color: colors.ink },
});
