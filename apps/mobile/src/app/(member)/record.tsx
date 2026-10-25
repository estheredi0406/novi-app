import type { Lender, RecordShareView, SavingsRecord } from "@novi/shared";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../api/client";
import { getRecord, listLenders, listShares, revokeShare, shareRecord, verifyUrl } from "../../api/record";
import { Badge } from "../../components/art/Badge";
import { BackHeader } from "../../components/BackHeader";
import { ErrorMessage } from "../../components/ErrorMessage";
import { PrimaryButton } from "../../components/PrimaryButton";
import { QrCode } from "../../components/QrCode";
import { Screen } from "../../components/Screen";
import { TextButton } from "../../components/TextButton";
import { formatDay, formatFcfa } from "../../lib/format";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// Her savings record, the ACEV (Sprint 6): facts, never a score. Only she
// sees it until she shares it (D33). She can share it with one MFI by name,
// whose staff then see it in their console (D54), or create a QR code for any
// lender (D50). Each share lasts 30 days, can be withdrawn, and she sees each
// time it was opened.
export default function RecordScreen() {
  const { t } = useTranslation();
  const [record, setRecord] = useState<SavingsRecord | null>(null);
  const [shares, setShares] = useState<RecordShareView[]>([]);
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getRecord().then(setRecord, (err: unknown) => setError(errorKey(err)));
    listShares().then(setShares, (err: unknown) => setError(errorKey(err)));
    listLenders().then(setLenders, (err: unknown) => setError(errorKey(err)));
  }, []);

  useEffect(load, [load]);

  async function share(mfiCode?: string) {
    setBusy(true);
    setError(null);
    try {
      await shareRecord(mfiCode);
      load();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  function confirmRevoke(shareId: string) {
    Alert.alert(t("record.revokeTitle"), t("record.revokeMessage"), [
      { text: t("common.back"), style: "cancel" },
      { text: t("record.revoke"), style: "destructive", onPress: () => void revokeShare(shareId).then(load, (err: unknown) => setError(errorKey(err))) },
    ]);
  }

  if (!record) {
    return (
      <Screen>
        <BackHeader listenText={t("record.title")} />
        <ErrorMessage messageKey={error} />
      </Screen>
    );
  }

  const facts: [string, string][] = [
    [t("record.memberSince"), formatDay(record.memberSince)],
    [t("record.groups"), t("record.groupsValue", { joined: record.groupsJoined, completed: record.groupsCompleted })],
    [t("record.payments"), String(record.paymentsMade)],
    [t("record.onTime"), String(record.paidOnTime)],
    [t("record.late"), String(record.paidLate)],
    [t("record.missed"), String(record.missed)],
    [t("record.saved"), formatFcfa(record.totalSavedFcfa)],
    [t("record.received"), t("record.receivedValue", { count: record.potsReceived, amount: formatFcfa(record.totalReceivedFcfa) })],
  ];
  const now = Date.now();
  const active = shares.filter((s) => !s.revokedAt && Date.parse(s.expiresAt) > now);
  const listen = `${t("record.title")}. ${t("record.lede")} ${facts.map(([k, v]) => `${k}: ${v}`).join(". ")}`;

  return (
    <Screen>
      <BackHeader listenText={listen} />
      <View style={styles.intro}>
        <Text style={[type.display, styles.indigo]}>{t("record.title")}</Text>
        <Text style={[type.body, styles.muted]}>{t("record.lede")}</Text>
      </View>

      <View style={styles.badges}>
        <Badge mark="coin" label={t("record.badgeFirstPayment")} earned={record.paymentsMade > 0} />
        <Badge mark="pot" label={t("record.badgeFirstPot")} earned={record.potsReceived > 0} />
        <Badge mark="circle" label={t("record.badgeCycle")} earned={record.groupsCompleted > 0} />
      </View>

      <View style={styles.card}>
        <Text style={[type.title, styles.ink]}>{record.legalName}</Text>
        {facts.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            <Text style={[type.body, styles.value]}>{value}</Text>
          </View>
        ))}
        <Text style={[type.small, styles.muted]}>{t("record.asOf", { date: formatDay(record.asOf) })}</Text>
      </View>

      {record.groups.map((group) => (
        <View key={group.name + group.mfiName} style={styles.group}>
          <Text style={[type.body, styles.name]}>{group.name}</Text>
          <Text style={[type.small, styles.muted]}>
            {t("record.groupLine", {
              mfi: group.mfiName,
              amount: formatFcfa(group.amountFcfa),
              paid: group.paid,
              due: group.roundsDue,
              onTime: group.onTime,
            })}
            {group.completed ? ` · ${t("record.completed")}` : ""}
          </Text>
        </View>
      ))}

      <ErrorMessage messageKey={error} />

      <View style={styles.section}>
        <Text style={[type.title, styles.ink]}>{t("record.shareTitle")}</Text>
        <Text style={[type.small, styles.muted]}>{t("record.shareHint")}</Text>
        {active.map((s) => (
          <View key={s.id} style={styles.card}>
            {s.sharedWith ? (
              <Text style={[type.title, styles.ink]}>{t("record.sharedWith", { name: s.sharedWith.name })}</Text>
            ) : (
              <QrCode value={verifyUrl(s.id)} label={t("record.qrLabel")} />
            )}
            <Text style={[type.small, styles.ink]}>{t("record.validUntil", { date: formatDay(s.expiresAt) })}</Text>
            <Text style={[type.small, styles.muted]}>
              {s.views === 0
                ? t("record.notViewed")
                : t("record.viewed", { count: s.views, date: formatDay(s.lastViewedAt ?? s.issuedAt) })}
            </Text>
            <TextButton label={t("record.revoke")} onPress={() => confirmRevoke(s.id)} />
          </View>
        ))}
        {lenders.map((lender) => (
          <PrimaryButton
            key={lender.code}
            label={t("record.shareWith", { name: lender.name })}
            onPress={() => void share(lender.code)}
            disabled={busy}
          />
        ))}
        <TextButton label={t("record.share")} onPress={() => void share()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 10 },
  badges: { flexDirection: "row", justifyContent: "space-between" },
  indigo: { color: colors.indigo },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  section: { gap: 12 },
  card: { gap: 10, padding: 18, borderRadius: 18, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.muted, flexShrink: 1 },
  value: { color: colors.ink, fontFamily: fonts.bodySemiBold },
  group: { gap: 4, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card },
  name: { fontFamily: fonts.bodySemiBold, color: colors.ink },
});
