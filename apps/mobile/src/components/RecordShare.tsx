import type { Lender, RecordShareView } from "@novi/shared";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { errorKey } from "../api/client";
import { listLenders, listShares, revokeShare, shareRecord, verifyUrl } from "../api/record";
import { Alert } from "../lib/alert";
import { formatDay } from "../lib/format";
import { colors } from "../theme/colors";
import { type } from "../theme/typography";
import { ErrorMessage } from "./ErrorMessage";
import { PrimaryButton } from "./PrimaryButton";
import { QrCode } from "./QrCode";
import { TextButton } from "./TextButton";

// Sharing her savings record (D50, D54), on the credit screen since D121:
// sharing it is how she shows a lender her seriousness, so it sits with the
// lender's conditions rather than in her history. She shares with one MFI by
// name, whose staff see it in their console, or makes a QR code for any
// lender. Each share lasts 30 days, can be withdrawn, and she sees each time
// it was opened.
export function RecordShare() {
  const { t } = useTranslation();
  const [shares, setShares] = useState<RecordShareView[]>([]);
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
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
      {
        text: t("record.revoke"),
        style: "destructive",
        onPress: () => void revokeShare(shareId).then(load, (err: unknown) => setError(errorKey(err))),
      },
    ]);
  }

  const active = shares.filter((s) => !s.revokedAt && Date.parse(s.expiresAt) > Date.now());

  return (
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
      <ErrorMessage messageKey={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  card: {
    gap: 10,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
});
