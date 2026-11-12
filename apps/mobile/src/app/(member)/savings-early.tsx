import type { SavingsAccountView } from "@novi/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../api/client";
import { getSavings, takeBackPlacement } from "../../api/savings";
import { BackHeader } from "../../components/BackHeader";
import { CowrieMark } from "../../components/BottomBar";
import { ErrorMessage } from "../../components/ErrorMessage";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { TextButton } from "../../components/TextButton";
import { formatFcfa, shortDay } from "../../lib/format";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

// D123: taking a placement back before its date. It is possible, the whole
// amount, but it earns nothing; so the screen first says what waiting brings,
// and "Garder mon placement" is the main button.
const F = (n: number) => formatFcfa(n).replace(" FCFA", " F");

export default function SavingsEarlyScreen() {
  const { t, i18n } = useTranslation();
  const { account, entry } = useLocalSearchParams<{ account: string; entry: string }>();
  const [a, setA] = useState<SavingsAccountView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSavings().then(
      (s) => setA(s.accounts.find((x) => x.id === account) ?? null),
      (err: unknown) => setError(errorKey(err)),
    );
  }, [account]);

  const lot = a?.locked.find((l) => l.id === entry);
  if (!a || !lot) {
    return (
      <Screen>
        <BackHeader listenText={t("savings.earlyTitle")} />
        <ErrorMessage messageKey={error} />
      </Screen>
    );
  }
  const date = shortDay(lot.unlockAt.slice(0, 10), i18n.language);
  const daysLeft = Math.max(1, Math.ceil((Date.parse(lot.unlockAt) - Date.now()) / 86_400_000));

  async function takeBack() {
    setBusy(true);
    setError(null);
    try {
      await takeBackPlacement(a!.id, lot!.id);
      router.back();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <BackHeader listenText={`${t("savings.earlyTitle")}. ${t("savings.waitTitle", { count: daysLeft })}`} />
      <Text style={styles.title}>{t("savings.earlyTitle")}</Text>

      <View style={styles.wait}>
        <CowrieMark size={30} fill={colors.yourTurn} />
        <Text style={styles.waitTitle}>{t("savings.waitTitle", { count: daysLeft })}</Text>
        {lot.gainAtEndFcfa ? (
          <>
            <Text style={styles.waitBig}>{F(lot.amountFcfa + lot.gainAtEndFcfa)}</Text>
            <Text style={styles.waitText}>{t("savings.waitText", { date, gain: F(lot.gainAtEndFcfa) })}</Text>
          </>
        ) : (
          <Text style={styles.waitText}>{t("savings.waitNoRate", { date })}</Text>
        )}
      </View>

      <View style={styles.now}>
        <Text style={styles.nowLabel}>{t("savings.ifNow")}</Text>
        <Text style={styles.nowValue}>{F(lot.amountFcfa)}</Text>
        {lot.gainAtEndFcfa ? <Text style={styles.lost}>{t("savings.lost", { gain: F(lot.gainAtEndFcfa) })}</Text> : null}
        <Text style={styles.small}>{t("savings.toPhone")}</Text>
      </View>

      <View style={styles.grow} />
      <ErrorMessage messageKey={error} />
      <PrimaryButton label={t("savings.keepPlacement")} onPress={() => router.back()} />
      <TextButton label={t("savings.takeBackAnyway", { amount: F(lot.amountFcfa) })} disabled={busy} onPress={() => void takeBack()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: 26, lineHeight: 34, color: colors.indigo },
  wait: { alignItems: "center", gap: 6, padding: 20, borderRadius: 22, backgroundColor: colors.paidSoft },
  waitTitle: { textAlign: "center", fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 22, color: colors.paid },
  waitBig: { fontFamily: fonts.display, fontSize: 34, lineHeight: 44, color: colors.paid },
  waitText: { textAlign: "center", fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink },
  now: { gap: 4, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  nowLabel: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  nowValue: { fontFamily: fonts.display, fontSize: 24, lineHeight: 32, color: colors.indigo },
  lost: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.problem },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  grow: { flexGrow: 1 },
});
