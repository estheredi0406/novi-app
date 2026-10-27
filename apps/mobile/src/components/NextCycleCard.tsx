import type { GroupDetail } from "@novi/shared";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, StyleSheet, Text, View } from "react-native";
import Svg from "react-native-svg";
import { errorKey } from "../api/client";
import { startNextCycle } from "../api/groups";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { Cowrie } from "./art/Cowrie";
import { ErrorMessage } from "./ErrorMessage";
import { PrimaryButton } from "./PrimaryButton";
import { TextButton } from "./TextButton";
import { WaxCard } from "./WaxCard";

// The end of a cycle (D72): every pot was paid. The organiser starts the
// next cycle with the same members in one step; the others see that she can.
export function NextCycleCard({ group }: { group: GroupDetail }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOrganiser = group.myRole === "ORGANISER";
  const open = (id: string) => router.push({ pathname: "/groups/[id]", params: { id } });

  function start() {
    Alert.alert(t("cycle.confirmTitle"), t("cycle.confirmBody", { number: group.cycleNumber + 1 }), [
      { text: t("cycle.notNow"), style: "cancel" },
      {
        text: t("cycle.start"),
        onPress: () => {
          setBusy(true);
          setError(null);
          startNextCycle(group.id).then(
            (next) => open(next.id),
            (err: unknown) => {
              setError(errorKey(err));
              setBusy(false);
            },
          );
        },
      },
    ]);
  }

  return (
    <WaxCard style={styles.card}>
      <View style={styles.head}>
        <Svg width={56} height={40} viewBox="0 0 84 60">
          <Cowrie cx={20} cy={30} rx={13} ry={20} rotate={-25} />
          <Cowrie cx={42} cy={30} rx={13} ry={20} fill={colors.teal} />
          <Cowrie cx={64} cy={30} rx={13} ry={20} rotate={25} fill={colors.gold} />
        </Svg>
        <View style={styles.text}>
          <Text style={styles.title}>{t("cycle.done", { number: group.cycleNumber })}</Text>
          <Text style={styles.sub}>{t("cycle.doneHint")}</Text>
        </View>
      </View>
      {group.nextCycleId ? (
        <TextButton
          label={t("cycle.openNext", { number: group.cycleNumber + 1 })}
          onPress={() => open(group.nextCycleId as string)}
        />
      ) : isOrganiser ? (
        <>
          <PrimaryButton label={t("cycle.start")} disabled={busy} onPress={start} />
          <Text style={styles.sub}>{t("cycle.startHint")}</Text>
        </>
      ) : (
        <Text style={styles.sub}>{t("cycle.organiserCan")}</Text>
      )}
      <ErrorMessage messageKey={error} />
    </WaxCard>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.indigo },
  sub: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
});
