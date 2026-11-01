import type { GroupHelp } from "@novi/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../../../api/client";
import { askSwap, getHelp } from "../../../../api/help";
import { Glyph } from "../../../../components/art/Glyph";
import { BackHeader } from "../../../../components/BackHeader";
import { ErrorMessage } from "../../../../components/ErrorMessage";
import { Screen } from "../../../../components/Screen";
import { shortDay } from "../../../../lib/format";
import { colors } from "../../../../theme/colors";
import { fonts, type } from "../../../../theme/typography";

// D87: she picks the member she would like to swap turns with. That member
// answers; then the organiser confirms. Only turns still to come are shown.
export default function SwapScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [help, setHelp] = useState<GroupHelp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getHelp(id).then(setHelp, (err: unknown) => setError(errorKey(err)));
  }, [id]);

  function confirm(partnerId: string, name: string, round: number) {
    Alert.alert(
      t("help.swapConfirmTitle"),
      t("help.swapConfirm", { name, mine: help?.myRound, theirs: round }),
      [
        { text: t("common.back"), style: "cancel" },
        {
          text: t("help.send"),
          onPress: () => {
            setBusy(true);
            setError(null);
            askSwap(id, partnerId).then(
              () => router.back(),
              (err: unknown) => {
                setError(errorKey(err));
                setBusy(false);
              },
            );
          },
        },
      ],
    );
  }

  return (
    <Screen>
      <BackHeader listenText={`${t("help.swapCta")}. ${t("help.swapIntro")}`} />
      <View style={styles.intro}>
        <Text style={[type.title, styles.indigo]}>{t("help.swapCta")}</Text>
        <Text style={[type.body, styles.muted]}>
          {t("help.swapIntro")}{" "}
          {help?.myRound ? t("help.yourTurnNow", { round: help.myRound }) : ""}
        </Text>
      </View>
      <View style={styles.list}>
        {help?.swapPartners.map((p, i) => (
          <Pressable
            key={p.memberId}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => confirm(p.memberId, p.name, p.round)}
            style={[
              styles.row,
              i < help.swapPartners.length - 1 && styles.line,
            ]}
          >
            <View style={styles.rowText}>
              <Text style={styles.name}>{p.name}</Text>
              <Text style={styles.sub}>
                {t("help.partnerTurn", {
                  round: p.round,
                  day: shortDay(p.dueDate, i18n.language),
                })}
              </Text>
            </View>
            <Glyph name="chevron" color={colors.indigo} />
          </Pressable>
        ))}
      </View>
      <ErrorMessage messageKey={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 8 },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
  list: {
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 56,
  },
  line: { borderBottomWidth: 1, borderBottomColor: colors.line },
  rowText: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
});
