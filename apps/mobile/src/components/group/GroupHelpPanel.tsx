import type { GroupHelp, TurnSwapView } from "@novi/shared";
import { type Href, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../api/client";
import {
  answerSwap,
  cancelSwap,
  decideSwap,
  getHelp,
} from "../../api/help";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";
import { Glyph } from "../art/Glyph";
import { ErrorMessage } from "../ErrorMessage";
import { HelpDot, Sheet } from "../Sheet";

// "Entraide" on the group page (D87): swap turns with another member. What
// waits for her answer comes first, with its two buttons; then the way to ask.
export function GroupHelpPanel({
  groupId,
  onChanged,
}: {
  groupId: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [help, setHelp] = useState<GroupHelp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [explain, setExplain] = useState(false);

  const load = useCallback(() => {
    getHelp(groupId).then(setHelp, (err: unknown) => setError(errorKey(err)));
  }, [groupId]);
  useFocusEffect(load);

  async function run(action: () => Promise<GroupHelp>, turnsMoved = false) {
    setBusy(true);
    setError(null);
    try {
      setHelp(await action());
      if (turnsMoved) onChanged();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  if (!help) return <ErrorMessage messageKey={error} />;

  const openSwaps = help.swaps.filter(
    (s) => s.status === "ASKED" || s.status === "AGREED",
  );

  const swapLine = (s: TurnSwapView) =>
    t("help.swapLine", {
      a: s.mine ? t("groupView.you") : s.requesterName,
      b: s.partnerName,
      x: s.requesterRound,
      y: s.partnerRound,
    });

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>{t("help.title")}</Text>
        <HelpDot label={t("help.what")} onPress={() => setExplain(true)} />
      </View>

      {openSwaps.map((s) => (
        <View key={s.id} style={styles.card}>
          <Text style={styles.cardTitle}>{swapLine(s)}</Text>
          <Text style={styles.cardSub}>
            {t(s.status === "ASKED" ? "help.swapAsked" : "help.swapAgreed")}
          </Text>
          {s.canAnswer ? (
            <Pair
              yes={t("help.accept")}
              no={t("help.refuse")}
              busy={busy}
              onYes={() =>
                void run(() => answerSwap(groupId, s.id, true), true)
              }
              onNo={() => void run(() => answerSwap(groupId, s.id, false))}
            />
          ) : s.canConfirm ? (
            <Pair
              yes={t("help.confirm")}
              no={t("help.refuse")}
              busy={busy}
              onYes={() =>
                void run(() => decideSwap(groupId, s.id, true), true)
              }
              onNo={() => void run(() => decideSwap(groupId, s.id, false))}
            />
          ) : s.canCancel ? (
            <Link
              label={t("help.withdraw")}
              onPress={() => void run(() => cancelSwap(groupId, s.id))}
            />
          ) : null}
        </View>
      ))}

      <ErrorMessage messageKey={error} />

      {help.canSwap ? (
        <Tile
          label={t("help.swapCta")}
          sub={
            help.myRound
              ? t("help.swapCtaSub", { round: help.myRound })
              : undefined
          }
          onPress={() =>
            router.push({
              pathname: "/groups/[id]/swap",
              params: { id: groupId },
            } as unknown as Href)
          }
        />
      ) : null}

      <Sheet
        visible={explain}
        title={t("help.title")}
        listenText={t("help.explain")}
        onClose={() => setExplain(false)}
      >
        <Text style={styles.sheetText}>{t("help.explain")}</Text>
      </Sheet>
    </View>
  );

  function Pair({
    yes,
    no,
    onYes,
    onNo,
    busy: disabled,
  }: {
    yes: string;
    no: string;
    onYes: () => void;
    onNo: () => void;
    busy: boolean;
  }) {
    return (
      <View style={styles.pair}>
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={onYes}
          style={[styles.btn, styles.btnYes]}
        >
          <Text style={styles.btnYesText}>{yes}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={() =>
            Alert.alert(no, t("help.refuseConfirm"), [
              { text: t("common.back"), style: "cancel" },
              { text: no, style: "destructive", onPress: onNo },
            ])
          }
          style={[styles.btn, styles.btnNo]}
        >
          <Text style={styles.btnNoText}>{no}</Text>
        </Pressable>
      </View>
    );
  }
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8}>
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

function Tile({
  label,
  sub,
  onPress,
}: {
  label: string;
  sub?: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.tile}>
      <View style={styles.tileText}>
        <Text style={styles.tileLabel}>{label}</Text>
        {sub ? <Text style={styles.cardSub}>{sub}</Text> : null}
      </View>
      <Glyph name="chevron" color={colors.indigo} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.indigo },
  card: {
    gap: 6,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.accent,
    backgroundColor: "#FFF4EC",
  },
  cardTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.ink,
  },
  cardSub: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  paid: { color: colors.paid, fontFamily: fonts.bodyBold },
  pair: { flexDirection: "row", gap: 10, marginTop: 4 },
  btn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnYes: { backgroundColor: colors.accent },
  btnYesText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.white },
  btnNo: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  btnNoText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.indigo },
  link: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.indigo,
    textDecorationLine: "underline",
    marginTop: 4,
  },
  tile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  tileText: { flex: 1, gap: 2 },
  tileLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.indigo },
  note: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  sheetText: {
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 25,
    color: colors.ink,
  },
});
