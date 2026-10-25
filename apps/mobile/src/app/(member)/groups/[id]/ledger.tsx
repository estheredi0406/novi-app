import type { LedgerLine } from "@novi/shared";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../../../api/client";
import { listLedger } from "../../../../api/money";
import { BackHeader } from "../../../../components/BackHeader";
import { ErrorMessage } from "../../../../components/ErrorMessage";
import { Screen } from "../../../../components/Screen";
import { formatDay, formatFcfa } from "../../../../lib/format";
import { colors } from "../../../../theme/colors";
import { fonts, type } from "../../../../theme/typography";

// The group's shared record of money, newest first. Lines are only ever
// added, never changed (D5), and every member sees the same lines.
export default function LedgerScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [lines, setLines] = useState<LedgerLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listLedger(id).then(setLines, (err: unknown) => setError(errorKey(err)));
  }, [id]);

  return (
    <Screen>
      <BackHeader listenText={`${t("money.ledgerTitle")}. ${t("money.ledgerLede")}`} />
      <View style={styles.intro}>
        <Text style={[type.display, styles.indigo]}>{t("money.ledgerTitle")}</Text>
        <Text style={[type.body, styles.muted]}>{t("money.ledgerLede")}</Text>
      </View>
      <ErrorMessage messageKey={error} />
      {lines?.length === 0 ? <Text style={[type.body, styles.muted]}>{t("money.ledgerEmpty")}</Text> : null}
      {lines?.map((line) => (
        <View key={line.id} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[type.body, styles.name]}>{line.memberName ?? ""}</Text>
            <Text style={[type.small, styles.muted]}>
              {t(`money.ledgerType.${line.type}`)}
              {line.roundNumber ? ` · ${t("money.roundShort", { number: line.roundNumber })}` : ""} · {formatDay(line.createdAt)}
            </Text>
          </View>
          <Text style={styles.amount}>{formatFcfa(line.amountFcfa)}</Text>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 10 },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bodySemiBold, color: colors.ink },
  amount: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
});
