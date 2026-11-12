import type { SavingsAccountView } from "@novi/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../api/client";
import { getSavings, withdrawSavings } from "../../api/savings";
import { BackHeader } from "../../components/BackHeader";
import { ErrorMessage } from "../../components/ErrorMessage";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { Stepper } from "../../components/savings/Stepper";
import { Alert } from "../../lib/alert";
import { formatFcfa, formatPhone } from "../../lib/format";
import { useSession } from "../../session/SessionProvider";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

// D123, canvas board 47: a withdrawal from her free savings, sent only to her
// own Novi number, from the MFI's account, like a pot.
const F = (n: number) => formatFcfa(n).replace(" FCFA", " F");

export default function SavingsWithdrawScreen() {
  const { t } = useTranslation();
  const { account } = useLocalSearchParams<{ account: string }>();
  const { phone } = useSession();
  const [a, setA] = useState<SavingsAccountView | null>(null);
  const [amount, setAmount] = useState(5000);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSavings().then(
      (s) => {
        const found = s.accounts.find((x) => x.id === account) ?? null;
        setA(found);
        if (found) setAmount(Math.min(5000, Math.floor(found.freeFcfa / 500) * 500));
      },
      (err: unknown) => setError(errorKey(err)),
    );
  }, [account]);

  if (!a) {
    return (
      <Screen>
        <BackHeader listenText={t("savings.withdraw")} />
        <ErrorMessage messageKey={error} />
      </Screen>
    );
  }
  const max = Math.floor(a.freeFcfa / 500) * 500;

  function send() {
    Alert.alert(t("savings.withdraw"), t("savings.withdrawConfirm", { amount: F(amount) }), [
      { text: t("common.back"), style: "cancel" },
      {
        text: t("savings.withdrawGo", { amount: F(amount) }),
        onPress: () => {
          setBusy(true);
          setError(null);
          withdrawSavings(a!.id, amount)
            .then(() => router.back())
            .catch((err: unknown) => setError(errorKey(err)))
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

  return (
    <Screen>
      <BackHeader listenText={t("savings.withdraw")} />
      <Text style={styles.title}>{t("savings.withdraw")}</Text>
      <Text style={styles.muted}>{t("savings.availableLine", { amount: F(a.freeFcfa) })}</Text>
      <Stepper
        value={amount}
        min={500}
        max={max}
        step={max >= 20_000 ? 1000 : 500}
        onChange={setAmount}
        lessLabel={t("savings.less")}
        moreLabel={t("savings.more")}
      />
      <View style={styles.quick}>
        {[5000, 10000, max].filter((v, i, all) => v >= 500 && v <= max && all.indexOf(v) === i).map((v) => (
          <Pressable key={v} accessibilityRole="button" onPress={() => setAmount(v)} style={styles.chip}>
            <Text style={styles.chipText}>{v === max ? t("savings.all") : F(v)}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.to}>
        <Text style={styles.muted}>{t("savings.to")}</Text>
        <Text style={styles.toNumber}>{phone ? formatPhone(phone) : ""}</Text>
      </View>
      <Text style={styles.note}>{t("savings.toNote")}</Text>
      <ErrorMessage messageKey={error} />
      <PrimaryButton label={t("savings.withdrawGo", { amount: F(amount) })} disabled={busy || max < 500} onPress={send} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 40, color: colors.indigo },
  muted: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  quick: { flexDirection: "row", gap: 8 },
  chip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  chipText: { textAlign: "center", fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  to: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  toNumber: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
});
