import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../api/client";
import { listMyGroups } from "../../api/groups";
import { BottomBar } from "../../components/BottomBar";
import { StatementView } from "../../components/hub/StatementView";
import { ListenButton } from "../../components/ListenButton";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Screen } from "../../components/Screen";
import { colors } from "../../theme/colors";
import { type } from "../../theme/typography";

// Historique (D92, simplified in D121 and D122): her money, month by month,
// across all her groups; her on-time record is on the credit screen. Nothing else: the badges are
// gone (nobody could tell what they meant), and sharing her record with a
// lender moved to the credit screen, where it is used.
export default function RecordScreen() {
  const { t } = useTranslation();
  const [nextPot, setNextPot] = useState<{ pot: number; date: string; group: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Her next pot to come, for "Reçu" while nothing came in yet (D122).
  useEffect(() => {
    listMyGroups().then(
      (groups) => {
        const next = groups
          .filter((g) => g.currentRound?.myTurn && g.currentRound.myTurn.payoutStatus !== "PAID")
          .map((g) => ({ pot: g.currentRound!.potFcfa, date: g.currentRound!.myTurn!.dueDate, group: g.name }))
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        setNextPot(next ?? null);
      },
      (err: unknown) => setError(errorKey(err)),
    );
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
      <StatementView nextPot={nextPot} />
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
