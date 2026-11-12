import type {
  GroupDetail,
  GroupSeat,
  MeetingsPage,
  RoundSummary,
} from "@novi/shared";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { Alert } from "../../../../lib/alert";
import { errorKey } from "../../../../api/client";
import {
  cancelGroup,
  cancelInvite,
  getGroup,
  invite,
  listMeetings,
  proposeGroup,
  removeSeat,
  startGroup,
} from "../../../../api/groups";
import { listRounds } from "../../../../api/money";
import { AnswerPanel } from "../../../../components/AnswerPanel";
import { BackHeader } from "../../../../components/BackHeader";
import { CheckRow } from "../../../../components/CheckRow";
import { ErrorMessage } from "../../../../components/ErrorMessage";
import { HeaderBand } from "../../../../components/HeaderBand";
import { Field } from "../../../../components/Field";
import { PrimaryButton } from "../../../../components/PrimaryButton";
import { RulesCard } from "../../../../components/RulesCard";
import { Screen } from "../../../../components/Screen";
import { TextButton } from "../../../../components/TextButton";
import { formatPhone } from "../../../../lib/format";
import { rulesSummary, seatLabel, stateLabel } from "../../../../lib/rulesText";
import { useSession } from "../../../../session/SessionProvider";
import { colors } from "../../../../theme/colors";
import { ChatEntry } from "../../../../components/ChatEntry";
import { MeetingsCard } from "../../../../components/MeetingsCard";
import { NextCycleCard } from "../../../../components/NextCycleCard";
import {
  GROUP_TABS,
  type GroupTab,
  RunningGroup,
} from "../../../../components/group/RunningGroup";
import { fonts, type } from "../../../../theme/typography";
import { usePhoneCountry } from "../../../../lib/phoneCountry";

// One group, as its members see it: rules, members, and the actions this
// person may take now. The API decides what is allowed; this screen only
// offers the buttons that make sense, so she is rarely refused.
export default function GroupScreen() {
  const { t } = useTranslation();
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { member } = useSession();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [meetings, setMeetings] = useState<MeetingsPage | null>(null);
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [digits, setDigits] = useState("");
  // D133: several numbers can be listed, then invited in one go.
  const [queue, setQueue] = useState<string[]>([]);
  const country = usePhoneCountry();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false); // D84

  // The group, and once it is running, its rounds (Sprint 3).
  const load = useCallback(() => {
    getGroup(id).then(
      (loaded) => {
        setGroup(loaded);
        if (loaded.state === "ACTIVE" || loaded.state === "COMPLETED") {
          listRounds(id).then(setRounds, (err: unknown) =>
            setError(errorKey(err)),
          );
        }
        if (loaded.state !== "DRAFT" && loaded.state !== "CANCELLED") {
          listMeetings(id).then(setMeetings, () => setMeetings(null));
        }
      },
      (err: unknown) => setError(errorKey(err)),
    );
  }, [id]);

  // Reloads when she comes back from changing the rules or the order.
  useFocusEffect(load);

  // Runs one action, then shows the group as the API now sees it.
  async function run(action: () => Promise<GroupDetail>) {
    setBusy(true);
    setError(null);
    try {
      setGroup(await action());
    } catch (err) {
      setError(errorKey(err));
      load();
    } finally {
      setBusy(false);
    }
  }

  // Asks before anything that cannot be undone.
  function confirm(
    title: string,
    message: string,
    label: string,
    action: () => Promise<GroupDetail>,
  ) {
    Alert.alert(title, message, [
      { text: t("common.back"), style: "cancel" },
      { text: label, style: "destructive", onPress: () => void run(action) },
    ]);
  }

  if (!group || !member) {
    return (
      <Screen>
        <BackHeader listenText={t("group.loading")} />
        <ErrorMessage messageKey={error} />
      </Screen>
    );
  }

  // Once it runs, the group lives in three tabs (approved design F1 to F3).
  if (
    (group.state === "ACTIVE" || group.state === "COMPLETED") &&
    rounds.length > 0
  ) {
    const open: GroupTab = GROUP_TABS.includes(tab as GroupTab)
      ? (tab as GroupTab)
      : "cotisation";
    return (
      <RunningGroup
        group={group}
        rounds={rounds}
        meetings={meetings}
        memberId={member.id}
        tab={open}
        onChanged={load}
      />
    );
  }

  const { rules, state } = group;
  const isOrganiser = group.myRole === "ORGANISER";
  const setup = state === "DRAFT" || state === "PROPOSED";
  const mySeat = group.seats.find((seat) => seat.memberId === member.id);
  const placesTaken = group.seats.length + group.pendingInvites.length;
  const full =
    group.seats.length === rules.size && group.pendingInvites.length === 0;
  const everyoneAccepted = group.seats.every(
    (seat) => seat.acceptedCurrentRules,
  );
  const started = group.seats.some((seat) => seat.payoutPosition !== null);
  const seats = started ? [...group.seats].sort(byTurn) : group.seats;

  const listen = `${group.name}. ${stateLabel(t, state)}. ${t("group.places", { taken: placesTaken, size: rules.size })}`;

  return (
    <Screen
      top={
        <HeaderBand>
          <BackHeader listenText={listen} />
          <Text style={styles.bandName}>{group.name}</Text>
          <Text style={styles.bandSub}>
            {group.cycleNumber > 1
              ? `${t("cycle.number", { number: group.cycleNumber })} · `
              : ""}
            {rounds.length > 0 ? rulesSummary(t, rules) : stateLabel(t, state)}
          </Text>
        </HeaderBand>
      }
    >
      {state === "COMPLETED" ? <NextCycleCard group={group} /> : null}

      {state !== "DRAFT" && state !== "CANCELLED" ? (
        <ChatEntry groupId={group.id} unread={group.unreadMessages} />
      ) : null}
      {state !== "DRAFT" && state !== "CANCELLED" ? (
        <MeetingsCard groupId={group.id} page={meetings} />
      ) : null}

      <RulesCard rules={rules} mfiName={group.mfiName} />

      {rounds.length > 0 ? (
        <View style={styles.section}>
          <TextButton
            label={t("money.openLedger")}
            onPress={() =>
              router.push({
                pathname: "/groups/[id]/ledger",
                params: { id: group.id },
              })
            }
          />
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={[type.title, styles.ink]}>
          {started
            ? t("group.turns")
            : t("group.places", { taken: placesTaken, size: rules.size })}
        </Text>

        {seats.map((seat) => (
          <View key={seat.memberId} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={[type.body, styles.name]}>
                {started ? `${seat.payoutPosition}. ` : ""}
                {seat.displayName}
                {seat.memberId === member.id ? ` ${t("group.you")}` : ""}
              </Text>
              <Text style={[type.small, styles.muted]}>
                {seat.role === "ORGANISER" ? `${t("group.organiser")} · ` : ""}
                {started ? "" : seatStatus(seat)}
              </Text>
              {seat.maskedPhone && seat.role !== "ORGANISER" ? (
                <Text style={[type.small, styles.muted]}>
                  {seat.maskedPhone}
                </Text>
              ) : null}
              {seat.counterNote ? (
                <Text style={[type.small, styles.quote]}>
                  “{seat.counterNote}”
                </Text>
              ) : null}
            </View>
            {isOrganiser && setup && seat.role !== "ORGANISER" ? (
              <TextButton
                label={t("group.remove")}
                disabled={busy}
                onPress={() =>
                  confirm(
                    t("group.removeTitle", { name: seat.displayName }),
                    t("group.removeMessage"),
                    t("group.remove"),
                    () => removeSeat(group.id, seat.memberId),
                  )
                }
              />
            ) : null}
          </View>
        ))}

        {group.pendingInvites.map((pending) => (
          <View key={pending.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={[type.body, styles.ink]}>{pending.maskedPhone}</Text>
              <Text style={[type.small, styles.muted]}>
                {t("group.invited")}
              </Text>
            </View>
            {isOrganiser ? (
              <TextButton
                label={t("group.withdraw")}
                disabled={busy}
                onPress={() =>
                  void run(() => cancelInvite(group.id, pending.id))
                }
              />
            ) : null}
          </View>
        ))}
      </View>

      <ErrorMessage messageKey={error} />

      {isOrganiser && setup && placesTaken < rules.size ? (
        <View style={styles.section}>
          <Field
            label={t("group.inviteLabel")}
            prefix={country.prefix}
            onPrefixPress={country.toggle}
            value={digits}
            onChangeText={(value) => setDigits(country.clean(value))}
            keyboardType="number-pad"
            textContentType="telephoneNumber"
            maxLength={country.length}
          />
          {queue.length + 1 < rules.size - placesTaken ? (
            <TextButton
              label={t("group.addToList")}
              disabled={busy || !country.valid(digits) || queue.includes(country.full(digits))}
              onPress={() => {
                setQueue([...queue, country.full(digits)]);
                setDigits("");
              }}
            />
          ) : null}
          {queue.length > 0 ? (
            <View style={styles.queue}>
              {queue.map((phone) => (
                <View key={phone} style={styles.queueRow}>
                  <Text style={[type.body, styles.ink]}>{formatPhone(phone)}</Text>
                  <TextButton label={t("group.removeFromList")} onPress={() => setQueue(queue.filter((p) => p !== phone))} />
                </View>
              ))}
            </View>
          ) : null}
          <PrimaryButton
            label={
              toSend().length > 1
                ? t("group.sendInvites", { count: toSend().length })
                : t("group.sendInvite")
            }
            disabled={busy || toSend().length === 0}
            onPress={() => confirmInvites(group.id, toSend())}
          />
          <Text style={[type.small, styles.muted]}>
            {t("group.inviteHint")}
          </Text>
        </View>
      ) : null}

      {isOrganiser && state === "DRAFT" ? (
        <View style={styles.section}>
          {/* D98: the organiser chooses too, for her own seat. */}
          <CheckRow checked={consent} onToggle={() => setConsent(!consent)}>
            {t("answer.shareConsent", { mfi: group.mfiName })}
          </CheckRow>
          <PrimaryButton
            label={t("group.propose")}
            disabled={busy}
            onPress={() => void run(() => proposeGroup(group.id, consent))}
          />
          <Text style={[type.small, styles.muted]}>
            {t("group.proposeHint")}
          </Text>
        </View>
      ) : null}

      {isOrganiser && state === "PROPOSED" ? (
        <View style={styles.section}>
          {rules.payoutOrder === "FIXED" ? (
            <TextButton
              label={t("group.setOrder")}
              disabled={busy || !full}
              onPress={() =>
                router.push({
                  pathname: "/groups/[id]/order",
                  params: { id: group.id },
                })
              }
            />
          ) : null}
          <PrimaryButton
            label={t("group.start")}
            disabled={busy || !full || !everyoneAccepted}
            onPress={() =>
              confirm(
                t("group.startTitle"),
                t("group.startMessage", {
                  names: group.seats.map((seat) => seat.displayName).join(", "),
                }),
                t("group.start"),
                () => startGroup(group.id),
              )
            }
          />
          <Text style={[type.small, styles.muted]}>
            {full && everyoneAccepted
              ? t("group.startReady")
              : t("group.startHint")}
          </Text>
        </View>
      ) : null}

      {isOrganiser && state === "STARTING" ? (
        <View style={styles.section}>
          <Text style={[type.body, styles.ink]}>
            {t("group.starting", { mfi: group.mfiName })}
          </Text>
          <PrimaryButton
            label={t("common.tryAgain")}
            disabled={busy}
            onPress={() => void run(() => startGroup(group.id))}
          />
        </View>
      ) : null}

      {!isOrganiser && setup && mySeat ? (
        mySeat.acceptedCurrentRules ? (
          <View style={styles.section}>
            <Text style={[type.body, styles.ink]}>
              {t("group.youAccepted", { version: rules.version })}
            </Text>
            <AnswerPanel
              groupId={group.id}
              mfiName={group.mfiName}
              version={rules.version}
              canAnswer={false}
              hasSeat
              waiting={false}
              onSeat={load}
              onDeclined={() => router.replace("/home")}
              onRulesChanged={load}
            />
          </View>
        ) : (
          <AnswerPanel
            groupId={group.id}
            mfiName={group.mfiName}
            version={rules.version}
            canAnswer={state === "PROPOSED"}
            hasSeat
            onSeat={load}
            onDeclined={() => router.replace("/home")}
            onRulesChanged={load}
          />
        )
      ) : null}

      {isOrganiser && setup ? (
        <View style={styles.footer}>
          <TextButton
            label={t("group.editRules")}
            disabled={busy}
            onPress={() =>
              router.push({
                pathname: "/groups/[id]/edit",
                params: { id: group.id },
              })
            }
          />
          <TextButton
            label={t("group.cancel")}
            disabled={busy}
            onPress={() =>
              confirm(
                t("group.cancelTitle"),
                t("group.cancelMessage"),
                t("group.cancel"),
                () => cancelGroup(group.id),
              )
            }
          />
        </View>
      ) : null}
    </Screen>
  );

  // The numbers listed, plus the one still in the field if it is complete.
  function toSend(): string[] {
    const typed = country.valid(digits) ? [country.full(digits)] : [];
    return [...queue, ...typed.filter((p) => !queue.includes(p))];
  }

  // Shows every whole number before the SMS go out: once sent, the group sees
  // only part of each, and a typo would invite someone else (D43). D133: the
  // numbers are sent one after the other; one refused (already invited, not a
  // valid number) does not stop the others, and the error says which.
  function confirmInvites(groupId: string, phones: string[]) {
    const list = phones.map(formatPhone).join(", ");
    Alert.alert(
      phones.length > 1
        ? t("group.invitesConfirmTitle", { count: phones.length, phones: list })
        : t("group.inviteConfirmTitle", { phone: list }),
      t("group.inviteConfirmMessage"),
      [
        { text: t("common.back"), style: "cancel" },
        {
          text: phones.length > 1 ? t("group.sendInvites", { count: phones.length }) : t("group.sendInvite"),
          onPress: () =>
            void (async () => {
              setBusy(true);
              setError(null);
              const failed: string[] = [];
              for (const phone of phones) {
                try {
                  setGroup(await invite(groupId, phone));
                } catch (err) {
                  failed.push(phone);
                  setError(errorKey(err));
                }
              }
              setQueue(failed);
              setDigits("");
              setBusy(false);
              if (failed.length > 0) load();
            })(),
        },
      ],
    );
  }

  // "Accepted", "Asked for a change", or "Not answered yet" when her
  // acceptance was of an older version.
  function seatStatus(seat: GroupSeat): string {
    if (seat.state === "ACCEPTED" && !seat.acceptedCurrentRules)
      return seatLabel(t, "INVITED");
    return seatLabel(t, seat.state);
  }
}

function byTurn(a: GroupSeat, b: GroupSeat): number {
  return (a.payoutPosition ?? 0) - (b.payoutPosition ?? 0);
}

const styles = StyleSheet.create({
  queue: { gap: 2, padding: 12, borderRadius: 14, backgroundColor: colors.mist },
  queueRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  bandName: {
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 32,
    color: colors.indigo,
  },
  bandSub: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.muted,
  },
  indigo: { color: colors.indigo },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  state: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.action },
  section: { gap: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bodySemiBold, color: colors.ink },
  quote: { color: colors.indigo, fontStyle: "italic" },
  footer: { marginTop: "auto", gap: 4 },
});
