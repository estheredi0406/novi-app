import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { Alert } from "../lib/alert";
import { ApiError, errorKey } from "../api/client";
import { acceptRules, counterRules, declineGroup } from "../api/groups";
import { getSavings } from "../api/savings";
import { router } from "expo-router";
import { colors } from "../theme/colors";
import { fonts, type } from "../theme/typography";
import { CheckRow } from "./CheckRow";
import { ErrorMessage } from "./ErrorMessage";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";
import { TextButton } from "./TextButton";

// Her answer to the rules (D39): accept, ask for a change, or say no. D147:
// right after she joins, Novi asks where her pot goes; if she skips it, a card
// on home asks again.
export async function askPot(groupId: string) {
  try {
    const { choices } = await getSavings();
    const open = choices.find((c) => c.groupId === groupId && !c.started && !c.chosen);
    if (open) router.push({ pathname: "/savings-choice" as never, params: { group: groupId } });
  } catch {
    // Home asks again; nothing is lost.
  }
}

export function AnswerPanel({
  groupId,
  mfiName,
  version,
  canAnswer,
  hasSeat,
  waiting = true,
  onSeat,
  onDeclined,
  onRulesChanged,
}: {
  groupId: string;
  mfiName: string;
  version: number;
  canAnswer: boolean;
  hasSeat: boolean;
  waiting?: boolean;
  onSeat: () => void;
  onDeclined: () => void;
  onRulesChanged: () => void;
}) {
  const { t } = useTranslation();
  const [consent, setConsent] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, after: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after();
    } catch (err) {
      setError(errorKey(err));
      // The organiser changed the rules while she was reading: show the new ones.
      if (err instanceof ApiError && err.code === "RULES_CHANGED")
        onRulesChanged();
    } finally {
      setBusy(false);
    }
  }

  // Saying no is confirmed first, and she is told it stays private.
  function confirmDecline() {
    Alert.alert(
      hasSeat ? t("answer.leaveTitle") : t("answer.declineTitle"),
      t("answer.declinePrivate"),
      [
        { text: t("common.back"), style: "cancel" },
        {
          text: hasSeat ? t("answer.leave") : t("answer.decline"),
          style: "destructive",
          onPress: () => void run(() => declineGroup(groupId), onDeclined),
        },
      ],
    );
  }

  return (
    <View style={styles.panel}>
      {canAnswer ? (
        <>
          {/* D98: sharing her record with the MFI is her choice; she can
              join without it, and the MFI sees it only while it validates. */}
          <Text style={[type.small, styles.muted]}>
            {t("answer.shareConsentNeeded", { mfi: mfiName })}
          </Text>
          <CheckRow checked={consent} onToggle={() => setConsent(!consent)}>
            {t("answer.shareConsent", { mfi: mfiName })}
          </CheckRow>
          <PrimaryButton
            label={t("answer.accept", { version })}
            onPress={() =>
              void run(() => acceptRules(groupId, version, consent), () => {
                onSeat();
                void askPot(groupId);
              })
            }
            disabled={busy}
          />
          {asking ? (
            <View style={styles.ask}>
              <Field
                label={t("answer.noteLabel")}
                value={note}
                onChangeText={setNote}
                maxLength={280}
                multiline
                placeholder={t("answer.notePlaceholder")}
                style={styles.note}
              />
              <PrimaryButton
                label={t("answer.sendNote")}
                onPress={() =>
                  void run(
                    () => counterRules(groupId, version, note.trim()),
                    onSeat,
                  )
                }
                disabled={busy || note.trim().length === 0}
              />
            </View>
          ) : (
            <TextButton
              label={t("answer.askChange")}
              onPress={() => setAsking(true)}
              disabled={busy}
            />
          )}
        </>
      ) : waiting ? (
        <Text style={[type.body, styles.muted]}>
          {t("answer.waitForRules")}
        </Text>
      ) : null}

      <ErrorMessage messageKey={error} />
      <TextButton
        label={hasSeat ? t("answer.leave") : t("answer.decline")}
        onPress={confirmDecline}
        disabled={busy}
      />
      <Text style={[type.small, styles.muted, styles.center]}>
        {t("answer.declinePrivate")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12 },
  ask: { gap: 12 },
  note: {
    fontFamily: fonts.body,
    fontSize: 17,
    minHeight: 90,
    textAlignVertical: "top",
  },
  muted: { color: colors.muted },
  center: { textAlign: "center" },
});
