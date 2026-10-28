import type { GroupDetail } from "@novi/shared";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import Svg from "react-native-svg";
import { errorKey } from "../api/client";
import { answerContinue, startNextCycle } from "../api/groups";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { Cowrie } from "./art/Cowrie";
import { ErrorMessage } from "./ErrorMessage";
import { PrimaryButton } from "./PrimaryButton";
import { TextButton } from "./TextButton";
import { WaxCard } from "./WaxCard";

// The end of a cycle (D72): every pot was paid. Each member says whether she
// goes again (D80), and the whole group sees the answers; the organiser then
// starts the next cycle, which invites everyone except those who stop.
export function NextCycleCard({ group, onChanged }: { group: GroupDetail; onChanged?: () => void }) {
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

  async function answer(continues: boolean) {
    setBusy(true);
    setError(null);
    try {
      await answerContinue(group.id, continues);
      onChanged?.();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  const votes = group.continueAnswers;
  const canAnswer = !group.nextCycleId && votes !== null && group.seats.some((s) => s.payoutPosition !== null);

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

      {canAnswer ? (
        <View style={styles.ask}>
          <Text style={styles.question}>{t("cycle.goAgain")}</Text>
          <View style={styles.choices}>
            {([true, false] as const).map((yes) => {
              const chosen = group.myContinue === yes;
              return (
                <Pressable
                  key={String(yes)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: chosen }}
                  disabled={busy}
                  onPress={() => void answer(yes)}
                  style={[styles.choice, chosen && (yes ? styles.choiceYes : styles.choiceNo)]}
                >
                  <Text style={[styles.choiceText, chosen && styles.choiceTextOn]}>
                    {chosen ? "✓ " : ""}
                    {t(yes ? "cycle.yes" : "cycle.no")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {votes ? (
            <View style={styles.votes}>
              <Text style={styles.vote}>
                <Text style={styles.voteYes}>{t("cycle.votesYes", { count: votes.yes.length })}</Text>
                {votes.yes.length ? ` · ${votes.yes.join(", ")}` : ""}
              </Text>
              {votes.no.length ? (
                <Text style={styles.vote}>
                  <Text style={styles.voteNo}>{t("cycle.votesNo", { count: votes.no.length })}</Text> · {votes.no.join(", ")}
                </Text>
              ) : null}
              {votes.waiting.length ? (
                <Text style={styles.vote}>
                  {t("cycle.votesWaiting", { count: votes.waiting.length })} · {votes.waiting.join(", ")}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
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
  ask: { gap: 10 },
  question: { fontFamily: fonts.display, fontSize: 20, color: colors.indigo },
  choices: { flexDirection: "row", gap: 10 },
  choice: {
    flex: 1,
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  choiceYes: { backgroundColor: colors.paid, borderColor: colors.paid },
  choiceNo: { backgroundColor: colors.indigo },
  choiceText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.indigo, textAlign: "center" },
  choiceTextOn: { color: colors.white },
  votes: { gap: 4, padding: 12, borderRadius: 14, backgroundColor: colors.shell },
  vote: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  voteYes: { fontFamily: fonts.bodyBold, color: colors.paid },
  voteNo: { fontFamily: fonts.bodyBold, color: colors.indigo },
});
