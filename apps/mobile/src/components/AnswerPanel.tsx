import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, StyleSheet, Text, View } from "react-native";
import { ApiError, errorKey } from "../api/client";
import { acceptRules, counterRules, declineGroup } from "../api/groups";
import { colors } from "../theme/colors";
import { fonts, type } from "../theme/typography";
import { CheckRow } from "./CheckRow";
import { ErrorMessage } from "./ErrorMessage";
import { Field } from "./Field";
import { PrimaryButton } from "./PrimaryButton";
import { TextButton } from "./TextButton";

// Her three answers to a group's rules (D39): accept, ask for a change, or
// say no. Used on an invitation and, after the rules change, on the group page.
// - canAnswer: false while the group is a draft; she can then only say no
// - hasSeat: she already holds a seat, so "say no" reads "leave the group"
// - waiting: when she cannot answer, explain that the rules are not sent yet
export function AnswerPanel({
  groupId,
  version,
  canAnswer,
  hasSeat,
  waiting = true,
  onSeat,
  onDeclined,
  onRulesChanged,
}: {
  groupId: string;
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
          {/* D84: FUCEC sees her Novi record only if she agrees; joining needs it. */}
          <Text style={[type.small, styles.muted]}>
            {t("answer.shareConsentNeeded")}
          </Text>
          <CheckRow checked={consent} onToggle={() => setConsent(!consent)}>
            {t("answer.shareConsent")}
          </CheckRow>
          <PrimaryButton
            label={t("answer.accept", { version })}
            onPress={() =>
              void run(() => acceptRules(groupId, version, true), onSeat)
            }
            disabled={busy || !consent}
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
