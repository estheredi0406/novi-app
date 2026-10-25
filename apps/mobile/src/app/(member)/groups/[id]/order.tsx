import type { GroupDetail } from "@novi/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../../../api/client";
import { getGroup, setPayoutOrder } from "../../../../api/groups";
import { BackHeader } from "../../../../components/BackHeader";
import { ErrorMessage } from "../../../../components/ErrorMessage";
import { PrimaryButton } from "../../../../components/PrimaryButton";
import { Screen } from "../../../../components/Screen";
import { TextButton } from "../../../../components/TextButton";
import { colors } from "../../../../theme/colors";
import { fonts, type } from "../../../../theme/typography";

// The organiser arranges who is paid first, second, and so on (D41). Saving
// makes it a new version of the rules, which every member accepts.
export default function OrderScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getGroup(id).then((loaded) => {
      setGroup(loaded);
      // Starts from the order already set, if it still names everyone.
      const ids = loaded.seats.map((seat) => seat.memberId);
      const saved = loaded.rules.fixedOrder;
      const stillValid = saved.length === ids.length && ids.every((memberId) => saved.includes(memberId));
      setOrder(stillValid ? saved : ids);
    }, (err: unknown) => setError(errorKey(err)));
  }, [id]);

  // Moves one member up or down by one place.
  function move(index: number, by: -1 | 1) {
    const next = [...order];
    const target = index + by;
    [next[index], next[target]] = [next[target] as string, next[index] as string];
    setOrder(next);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setPayoutOrder(id, order);
      router.back();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (memberId: string) => group?.seats.find((seat) => seat.memberId === memberId)?.displayName ?? "";

  return (
    <Screen>
      <BackHeader listenText={`${t("order.title")}. ${t("order.lede")}`} />
      <View style={styles.intro}>
        <Text style={[type.display, styles.indigo]}>{t("order.title")}</Text>
        <Text style={[type.body, styles.muted]}>{t("order.lede")}</Text>
      </View>

      {order.map((memberId, index) => (
        <View key={memberId} style={styles.row}>
          <Text style={[type.body, styles.name]}>{`${index + 1}. ${nameOf(memberId)}`}</Text>
          <TextButton label={t("order.up")} disabled={index === 0} onPress={() => move(index, -1)} />
          <TextButton label={t("order.down")} disabled={index === order.length - 1} onPress={() => move(index, 1)} />
        </View>
      ))}

      <ErrorMessage messageKey={error} />
      <View style={styles.footer}>
        <PrimaryButton label={t("order.save")} onPress={() => void save()} disabled={busy || order.length === 0} />
      </View>
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
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  name: { flex: 1, fontFamily: fonts.bodySemiBold, color: colors.ink },
  footer: { marginTop: "auto" },
});
