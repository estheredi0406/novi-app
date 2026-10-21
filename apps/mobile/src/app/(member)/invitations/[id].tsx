import type { Invitation } from "@novi/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../../api/client";
import { listMyInvitations } from "../../../api/groups";
import { AnswerPanel } from "../../../components/AnswerPanel";
import { BackHeader } from "../../../components/BackHeader";
import { ErrorMessage } from "../../../components/ErrorMessage";
import { RulesCard } from "../../../components/RulesCard";
import { Screen } from "../../../components/Screen";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/typography";

// An invitation, as the invited person reads it before deciding: who invites
// her, the exact rules, and where the money is held. The group's members are
// not shown until she has a seat.
export default function InvitationScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read from her list of invitations: found by her own number, never by search.
  const load = useCallback(() => {
    listMyInvitations().then(
      (all) => {
        const found = all.find((item) => item.id === id);
        if (found) setInvitation(found);
        else router.replace("/home"); // withdrawn, or already answered
      },
      (err: unknown) => setError(errorKey(err)),
    );
  }, [id]);

  useEffect(load, [load]);

  if (!invitation) {
    return (
      <Screen>
        <BackHeader listenText={t("group.loading")} />
        <ErrorMessage messageKey={error} />
      </Screen>
    );
  }

  const title = t("invitation.title", { organiser: invitation.organiserName });
  const places = t("group.places", { taken: invitation.seatsHeld, size: invitation.rules.size });

  return (
    <Screen>
      <BackHeader listenText={`${title}. ${invitation.groupName}. ${places}`} />
      <View style={styles.intro}>
        <Text style={[type.body, styles.muted]}>{title}</Text>
        <Text style={[type.display, styles.indigo]}>{invitation.groupName}</Text>
        <Text style={[type.small, styles.muted]}>{places}</Text>
      </View>

      <RulesCard rules={invitation.rules} mfiName={invitation.mfiName} />

      <View style={styles.warning}>
        <Text style={[type.body, styles.ink]}>{t("invitation.onlyIfKnown", { organiser: invitation.organiserName })}</Text>
      </View>

      <AnswerPanel
        groupId={invitation.groupId}
        version={invitation.rules.version}
        canAnswer={invitation.groupState === "PROPOSED"}
        hasSeat={false}
        onSeat={() => router.replace({ pathname: "/groups/[id]", params: { id: invitation.groupId } })}
        onDeclined={() => router.replace("/home")}
        onRulesChanged={load}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 6 },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
  ink: { color: colors.ink },
  warning: { padding: 16, borderRadius: 14, backgroundColor: colors.mist },
});
