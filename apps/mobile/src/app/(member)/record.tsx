import type { SavingsRecord } from "@novi/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../api/client";
import { getRecord } from "../../api/record";
import { BottomBar } from "../../components/BottomBar";
import { StatementView } from "../../components/hub/StatementView";
import { ListenButton } from "../../components/ListenButton";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Screen } from "../../components/Screen";
import { colors } from "../../theme/colors";
import { type } from "../../theme/typography";

// Historique (D92, simplified in D121): her money, month by month, across all
// her groups, with her on-time share at the top. Nothing else: the badges are
// gone (nobody could tell what they meant), and sharing her record with a
// lender moved to the credit screen, where it is used.
export default function RecordScreen() {
  const { t } = useTranslation();
  const [record, setRecord] = useState<SavingsRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRecord().then(setRecord, (err: unknown) => setError(errorKey(err)));
  }, []);

  return (
    <Screen bar={<BottomBar active="record" />}>
      <View style={styles.top}>
        <ListenButton text={`${t("record.title")}. ${t("record.lede")}`} />
      </View>
      <View style={styles.intro}>
        <Text style={[type.display, styles.indigo]}>{t("record.title")}</Text>
        <Text style={[type.body, styles.muted]}>{t("record.lede")}</Text>
      </View>
      {record ? <StatementView record={record} /> : null}
      <ErrorMessage messageKey={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", justifyContent: "flex-end" },
  intro: { gap: 10 },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
});
