import type {
  LoanCheck,
  LoanDocumentView,
  LoanPage,
  LoanPurpose,
  LoanRequestView,
} from "@novi/shared";
import { useFocusEffect } from "expo-router";
import type { TFunction } from "i18next";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Alert } from "../../lib/alert";
import { errorKey } from "../../api/client";
import {
  bringOnPaper,
  consentToDocuments,
  getLoans,
  requestLoan,
  sendDocument,
  withdrawLoan,
} from "../../api/help";
import { BackHeader } from "../../components/BackHeader";
import { CheckRow } from "../../components/CheckRow";
import { Chip } from "../../components/Chip";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Field } from "../../components/Field";
import { RecordShare } from "../../components/RecordShare";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { TextButton } from "../../components/TextButton";
import { formatDay, formatFcfa } from "../../lib/format";
import { canPickPhotos, pickPhoto } from "../../lib/pickPhoto";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

const PURPOSES: LoanPurpose[] = ["STOCK", "EQUIPMENT", "OTHER"];

// One of the MFI's conditions, in words, with her own figure (D91).
function checkText(t: TFunction, c: LoanCheck): [string, string] {
  const f = c.figures;
  switch (c.key) {
    case "CYCLE_OR_STREAK":
      return [
        t("loan.cond.cycle", { cycles: f.minCycles, streak: f.minStreak }),
        t("loan.cond.cycleHave", { cycles: f.cycles, streak: f.streak }),
      ];
    case "ON_TIME":
      return [
        t("loan.cond.onTime", { min: f.min }),
        t("loan.cond.onTimeHave", {
          percent: f.percent,
          on: f.onTime,
          made: f.made,
        }),
      ];
    case "NO_DEBT":
      return [
        t("loan.cond.noDebt"),
        f.owes
          ? t("loan.cond.owes", { amount: formatFcfa(f.owes) })
          : t("loan.cond.owesNothing"),
      ];
    case "WAIT_AFTER_REFUSAL":
      return [
        t("loan.cond.wait", { days: f.wait }),
        f.days ? t("loan.cond.refusedAgo", { days: f.days }) : "",
      ];
    default:
      return [t("loan.cond.open"), ""];
  }
}

// D89, D91: "Crédit". The MFI's conditions with her figures; when they
// are met, the request. Then, once preselected, her documents: she agrees,
// photographs each one, and sees the officer's answer. When all are accepted
// she goes to the agency with the originals; the MFI decides there.
export default function LoanScreen() {
  const { t } = useTranslation();
  const [page, setPage] = useState<LoanPage | null>(null);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState<LoanPurpose>("STOCK");
  const [showChecks, setShowChecks] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    getLoans().then(setPage, (err: unknown) => setError(errorKey(err)));
  }, []);
  useFocusEffect(load);

  async function run(key: string, action: () => Promise<LoanPage>) {
    setBusy(key);
    setError(null);
    try {
      setPage(await action());
      setAmount("");
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(null);
    }
  }

  if (!page) {
    return (
      <Screen>
        <BackHeader listenText={t("loan.menu")} />
        <ErrorMessage messageKey={error} />
      </Screen>
    );
  }

  const mfi = page.mfiName ?? t("loan.yourMfi");
  const latest = page.requests.find((r) => r.status !== "WITHDRAWN");
  const latestOpen = latest?.status === "PENDING" || latest?.status === "PRESELECTED";
  const value = Number(amount.replace(/\D/g, ""));
  const valid = value >= 5000 && value <= page.ceilingFcfa;

  function send() {
    Alert.alert(
      t("loan.confirmTitle"),
      t("loan.confirm", { amount: formatFcfa(value), mfi }),
      [
        { text: t("common.back"), style: "cancel" },
        {
          text: t("loan.send"),
          onPress: () =>
            void run("send", () => requestLoan(value, purpose)),
        },
      ],
    );
  }

  async function photo(loan: LoanRequestView, doc: LoanDocumentView) {
    const take = async (source: "camera" | "library") => {
      const picked = await pickPhoto(source);
      if (picked === "cancelled") return;
      if (picked === "denied") return setError("loan.photoDenied");
      if (picked === "tooLarge") return setError("loan.documentInvalid");
      await run(doc.key, () => sendDocument(loan.id, doc.key, picked));
    };
    Alert.alert(doc.label, t("loan.photoHow"), [
      { text: t("loan.photoCamera"), onPress: () => void take("camera") },
      { text: t("loan.photoLibrary"), onPress: () => void take("library") },
      { text: t("common.back"), style: "cancel" },
    ]);
  }

  return (
    <Screen>
      <BackHeader
        listenText={`${t("loan.title", { mfi })}. ${t("loan.intro", { mfi })}`}
      />
      <View style={styles.intro}>
        <Text style={[type.title, styles.indigo]}>
          {t("loan.title", { mfi })}
        </Text>
        <Text style={[type.body, styles.muted]}>
          {t("loan.intro", { mfi })}
        </Text>
      </View>

      {latest ? <RequestStatus loan={latest} mfi={mfi} /> : null}

      {latest?.status === "PRESELECTED" ? (
        <View style={styles.box}>
          <Text style={styles.boxTitle}>{t("loan.docsTitle")}</Text>
          {!latest.documentsConsented ? (
            <>
              <Text style={[type.small, styles.ink]}>
                {t("loan.docsConsentText", { mfi })}
              </Text>
              <CheckRow checked={consent} onToggle={() => setConsent(!consent)}>
                {t("loan.docsConsent", { mfi })}
              </CheckRow>
              <PrimaryButton
                label={t("loan.docsStart")}
                disabled={!consent || busy !== null}
                onPress={() =>
                  void run("consent", () => consentToDocuments(latest.id))
                }
              />
            </>
          ) : (
            <>
              {!canPickPhotos() ? (
                <Text style={[type.small, styles.muted]}>
                  {t("loan.photoUpdateApp")}
                </Text>
              ) : null}
              {latest.documents.map((d) => (
                <View key={d.key} style={styles.doc}>
                  <View style={styles.docText}>
                    <Text style={styles.docLabel}>{d.label}</Text>
                    <Text
                      style={[
                        styles.docStatus,
                        d.status === "ACCEPTED" && styles.ok,
                        d.status === "REDO" && styles.problem,
                      ]}
                    >
                      {t(`loan.docStatus.${d.status}`, { mfi })}
                      {d.note ? ` : « ${d.note} »` : ""}
                    </Text>
                  </View>
                  {d.status === "MISSING" || d.status === "REDO" ? (
                    <TextButton
                      label={t("loan.onPaper")}
                      disabled={busy !== null}
                      onPress={() => void run(d.key, () => bringOnPaper(latest.id, d.key))}
                    />
                  ) : null}
                  {d.status !== "ACCEPTED" && canPickPhotos() ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy !== null}
                      onPress={() => void photo(latest, d)}
                      style={styles.docButton}
                    >
                      <Text style={styles.docButtonText}>
                        {busy === d.key
                          ? "…"
                          : d.status === "MISSING"
                            ? t("loan.photoSend")
                            : t("loan.photoRedo")}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
              <Text style={[type.small, styles.muted]}>
                {t("loan.docsPrivacy", { mfi })}
              </Text>
            </>
          )}
        </View>
      ) : null}

      {latest &&
      (latest.status === "PENDING" || latest.status === "PRESELECTED") ? (
        <TextButton
          label={t("loan.withdraw")}
          disabled={busy !== null}
          onPress={() => void run("withdraw", () => withdrawLoan(latest.id))}
        />
      ) : null}

      {!page.enabled ? (
        <Text style={[type.body, styles.muted]}>
          {t("loan.closed", { mfi })}
        </Text>
      ) : null}

      {/* D118: when she can ask, say it in one line; the conditions fold away. */}
      {page.enabled && page.eligible && !latestOpen ? (
        <View style={styles.eligible}>
          <Text style={styles.eligibleOk}>{t("loan.allMet")}</Text>
          <Text style={styles.eligibleTitle}>{t("loan.canAsk", { amount: formatFcfa(page.ceilingFcfa), mfi })}</Text>
          <Pressable accessibilityRole="button" onPress={() => setShowChecks(!showChecks)} style={styles.eligibleLink}>
            <Text style={styles.eligibleLinkText}>{showChecks ? t("loan.hideConditions") : t("loan.seeConditions")}</Text>
          </Pressable>
        </View>
      ) : null}

      {page.enabled && (!page.eligible || latestOpen || showChecks) ? (
        <View style={styles.checks}>
          <Text style={styles.boxTitle}>{t("loan.conditions", { mfi })}</Text>
          {page.checks.map((c) => {
            const [text, have] = checkText(t, c);
            return (
              <View key={c.key} style={styles.check}>
                <Text
                  style={[styles.mark, c.ok ? styles.markOk : styles.markNo]}
                >
                  {c.ok ? "✓" : "–"}
                </Text>
                <View style={styles.checkText}>
                  <Text style={styles.checkLine}>{text}</Text>
                  {have ? (
                    <Text style={[styles.have, c.ok && styles.ok]}>
                      {t("loan.you", { what: have })}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {page.enabled &&
      !page.eligible &&
      page.onTimeNeeded &&
      page.onTimeNeeded > 0 ? (
        <View style={styles.box}>
          <Text style={styles.boxTitle}>{t("loan.almost")}</Text>
          <Text style={[type.small, styles.ink]}>
            {t("loan.almostText", {
              count: page.onTimeNeeded,
              amount: formatFcfa(page.ceilingFcfa),
            })}
          </Text>
        </View>
      ) : null}

      {page.eligible ? (
        <View style={styles.form}>
          <Field
            label={t("loan.amountLabel", { max: formatFcfa(page.ceilingFcfa) })}
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            maxLength={8}
            prefix="FCFA"
          />
          <Text style={styles.label}>{t("loan.purposeLabel")}</Text>
          <View style={styles.chips}>
            {PURPOSES.map((p) => (
              <Chip
                key={p}
                label={t(`loan.purpose.${p}`)}
                selected={purpose === p}
                onPress={() => setPurpose(p)}
              />
            ))}
          </View>
          {/* D118: what she will need, before she asks. */}
          <View style={styles.box}>
            <Text style={styles.boxTitle}>{t("loan.docsToPrepare", { count: page.documents.length })}</Text>
            {page.documents.map((d) => (
              <Text key={d.key} style={[type.small, styles.ink]}>
                • {d.label}
              </Text>
            ))}
          </View>
          <Text style={[type.small, styles.muted]}>
            {t("loan.atAgency", { mfi })} {t("loan.shareNote", { mfi })}
          </Text>
          <PrimaryButton
            label={t("loan.send")}
            disabled={busy !== null || !valid}
            onPress={send}
          />
        </View>
      ) : null}
      <ErrorMessage messageKey={error} />

      {/* D121: sharing her record sits here, with the lender's conditions. */}
      <RecordShare />
    </Screen>
  );
}

// Where her latest request stands, in one card.
function RequestStatus({ loan, mfi }: { loan: LoanRequestView; mfi: string }) {
  const { t } = useTranslation();
  const ok =
    loan.status === "GRANTED" ||
    loan.status === "APPROVED" ||
    (loan.status === "PRESELECTED" && loan.documentsComplete);
  const title =
    loan.status === "PENDING"
      ? t("loan.pending", { mfi })
      : loan.status === "PRESELECTED"
        ? loan.documentsComplete
          ? t("loan.fileComplete")
          : t("loan.preselected")
        : loan.status === "GRANTED" || loan.status === "APPROVED"
          ? t("loan.approved", {
              amount: formatFcfa(loan.grantedFcfa ?? loan.amountFcfa),
            })
          : loan.status === "NOT_GRANTED"
            ? t("loan.notGranted")
            : t("loan.declined");
  const sub =
    loan.status === "PENDING"
      ? t("loan.pendingSub")
      : loan.status === "PRESELECTED"
        ? loan.documentsComplete
          ? t("loan.fileCompleteSub", { mfi })
          : t("loan.preselectedSub", { mfi })
        : loan.status === "APPROVED"
          ? t("loan.goToAgency", { mfi })
          : null;
  return (
    <View style={[styles.status, ok && styles.statusOk]}>
      <Text style={styles.statusTitle}>{title}</Text>
      {sub ? <Text style={styles.statusSub}>{sub}</Text> : null}
      <Text style={styles.statusSub}>
        {t("loan.requestLine", {
          amount: formatFcfa(loan.amountFcfa),
          purpose: t(`loan.purpose.${loan.purpose}`),
          day: formatDay(loan.createdAt.slice(0, 10)),
        })}
      </Text>
      {loan.decisionNote ? (
        <Text style={styles.statusSub}>« {loan.decisionNote} »</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 8 },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
  ink: { color: colors.ink },
  status: {
    gap: 4,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  statusOk: { borderColor: colors.paid, backgroundColor: colors.paidSoft },
  statusTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 18,
    lineHeight: 24,
    color: colors.indigo,
  },
  statusSub: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.ink,
  },
  box: {
    gap: 10,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  boxTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.indigo },
  doc: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  docText: { flex: 1, gap: 2 },
  docLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.ink,
  },
  docStatus: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  eligible: { backgroundColor: colors.indigo, borderRadius: 20, padding: 18, gap: 6 },
  eligibleOk: { fontFamily: fonts.bodyBold, fontSize: 14, color: "#8FD3AE" },
  eligibleTitle: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: colors.white },
  eligibleLink: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  eligibleLinkText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.white, textDecorationLine: "underline" },
  docButton: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.action,
    justifyContent: "center",
  },
  docButtonText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.white,
  },
  ok: { color: colors.paid },
  problem: { color: colors.problem },
  checks: {
    gap: 4,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.mist,
  },
  check: { flexDirection: "row", gap: 10, paddingVertical: 6 },
  mark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    textAlign: "center",
    lineHeight: 24,
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    overflow: "hidden",
  },
  markOk: { backgroundColor: colors.paid, color: colors.white },
  markNo: { backgroundColor: colors.card, color: colors.indigo },
  checkText: { flex: 1, gap: 2 },
  checkLine: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.ink,
  },
  have: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.muted },
  form: { gap: 12 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
