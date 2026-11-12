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
import { ErrorMessage } from "../../components/ErrorMessage";
import { LineIcon } from "../../components/LineIcon";
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
    case "SAVINGS": // D123
      return [t("loan.cond.savings"), ""];
    default:
      return [t("loan.cond.open"), ""];
  }
}

// D89, D91, redrawn in D122 from canvas boards 19 to 21: "Crédit". Not yet:
// what is missing, what is already fine, her ceiling (19). She can ask: the
// amount with − and +, what for, the documents to prepare (20). Her request,
// step by step, with her documents inside step 3 (21). Then, once preselected, her documents: she agrees,
// photographs each one, and sees the officer's answer. When all are accepted
// she goes to the agency with the originals; the MFI decides there.
export default function LoanScreen() {
  const { t } = useTranslation();
  const [page, setPage] = useState<LoanPage | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
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
      setAmount(null);
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
  const latestOpen =
    latest?.status === "PENDING" || latest?.status === "PRESELECTED";
  // D122, board 20: the amount with − and +, from 5 000 F to her ceiling.
  const stepF = page.ceilingFcfa > 100_000 ? 10_000 : 5_000;
  const top = Math.max(5_000, Math.floor(page.ceilingFcfa / 5_000) * 5_000);
  const value =
    amount ??
    Math.min(
      top,
      Math.max(5_000, Math.round(page.ceilingFcfa / 2 / 5_000) * 5_000),
    );
  const valid = value >= 5000 && value <= page.ceilingFcfa;
  const okChecks = page.checks.filter((c) => c.ok);
  const missing = page.checks.filter((c) => !c.ok);

  function send() {
    Alert.alert(
      t("loan.confirmTitle"),
      t("loan.confirm", { amount: formatFcfa(value), mfi }),
      [
        { text: t("common.back"), style: "cancel" },
        {
          text: t("loan.send"),
          onPress: () => void run("send", () => requestLoan(value, purpose)),
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

  // Her documents, inside step 3 of her request (D89; D122).
  const docsBlock = latest ? (
    <>
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
              <View style={styles.docActions}>
                {d.status === "MISSING" || d.status === "REDO" ? (
                  <TextButton
                    label={t("loan.onPaper")}
                    disabled={busy !== null}
                    onPress={() =>
                      void run(d.key, () => bringOnPaper(latest.id, d.key))
                    }
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
            </View>
          ))}
          <Text style={[type.small, styles.muted]}>
            {t("loan.docsPrivacy", { mfi })}
          </Text>
        </>
      )}
    </>
  ) : null;

  function steps(loan: LoanRequestView) {
    type Step = {
      key: string;
      title: string;
      sub?: string;
      state: "done" | "now" | "todo" | "failed";
    };
    const s = loan.status;
    const day = (iso: string | null) =>
      iso ? formatDay(iso.slice(0, 10)) : undefined;
    const preDone =
      s === "PRESELECTED" ||
      s === "APPROVED" ||
      s === "GRANTED" ||
      s === "NOT_GRANTED";
    const docsDone =
      (s === "PRESELECTED" && loan.documentsComplete) ||
      s === "APPROVED" ||
      s === "GRANTED" ||
      s === "NOT_GRANTED";
    const accepted = loan.documents.filter(
      (d) => d.status === "ACCEPTED",
    ).length;
    const out: Step[] = [
      {
        key: "sent",
        title: t("loan.stepSent"),
        sub: day(loan.createdAt),
        state: "done",
      },
      s === "DECLINED"
        ? {
            key: "kept",
            title: t("loan.declined"),
            sub: loan.decisionNote
              ? `« ${loan.decisionNote} »`
              : day(loan.decidedAt),
            state: "failed",
          }
        : {
            key: "kept",
            title: t("loan.stepKept", { mfi }),
            sub: preDone ? undefined : t("loan.stepKeptNow", { mfi }),
            state: preDone ? "done" : "now",
          },
    ];
    if (s === "DECLINED") return out;
    out.push({
      key: "docs",
      title: loan.documents.length
        ? t("loan.stepDocs", { done: accepted, count: loan.documents.length })
        : t("loan.docsTitle"),
      state: docsDone ? "done" : s === "PRESELECTED" ? "now" : "todo",
    });
    out.push({
      key: "agency",
      title: t("loan.stepAgency"),
      sub:
        s === "PRESELECTED" && loan.documentsComplete
          ? t("loan.fileCompleteSub", { mfi })
          : undefined,
      state:
        s === "APPROVED" || s === "GRANTED" || s === "NOT_GRANTED"
          ? "done"
          : docsDone
            ? "now"
            : "todo",
    });
    out.push(
      s === "APPROVED" || s === "GRANTED"
        ? {
            key: "answer",
            title: t("loan.approved", {
              amount: formatFcfa(loan.grantedFcfa ?? loan.amountFcfa),
            }),
            sub:
              s === "APPROVED"
                ? t("loan.goToAgency", { mfi })
                : t("loan.grantedSub"),
            state: "done",
          }
        : s === "NOT_GRANTED"
          ? {
              key: "answer",
              title: t("loan.notGranted"),
              sub: loan.decisionNote ? `« ${loan.decisionNote} »` : undefined,
              state: "failed",
            }
          : {
              key: "answer",
              title: t("loan.stepAnswer", { mfi }),
              state: "todo",
            },
    );
    return out;
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

      {/* D122, board 21: where her request stands, step by step. */}
      {latest ? (
        <View style={styles.follow}>
          <View>
            <Text style={styles.followTitle}>{t("loan.myRequest")}</Text>
            <Text style={[type.small, styles.muted]}>
              {t("loan.requestShort", {
                amount: formatFcfa(latest.amountFcfa),
                purpose: t(`loan.purpose.${latest.purpose}`),
              })}
            </Text>
          </View>
          <View style={styles.steps}>
            {steps(latest).map((st, i, all) => (
              <View key={st.key} style={styles.step}>
                <View style={styles.rail}>
                  <View style={[styles.dot, styles[`dot_${st.state}`]]}>
                    {st.state === "done" ? (
                      <LineIcon name="check" size={14} color={colors.white} />
                    ) : (
                      <Text
                        style={[
                          styles.dotText,
                          st.state === "todo" && styles.dotTextTodo,
                        ]}
                      >
                        {st.state === "failed" ? "×" : i + 1}
                      </Text>
                    )}
                  </View>
                  {i < all.length - 1 ? (
                    <View
                      style={[
                        styles.railLine,
                        st.state === "done" && styles.railLineDone,
                      ]}
                    />
                  ) : null}
                </View>
                <View style={styles.stepBody}>
                  <Text
                    style={[
                      styles.stepTitle,
                      st.state === "todo" && styles.muted,
                      st.state === "failed" && styles.problem,
                    ]}
                  >
                    {st.title}
                  </Text>
                  {st.sub ? <Text style={styles.stepSub}>{st.sub}</Text> : null}
                  {st.key === "docs" && st.state === "now" ? (
                    <View style={styles.docsInStep}>{docsBlock}</View>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
          {latestOpen ? (
            <TextButton
              label={t("loan.withdraw")}
              disabled={busy !== null}
              onPress={() =>
                void run("withdraw", () => withdrawLoan(latest.id))
              }
            />
          ) : null}
        </View>
      ) : null}

      {!page.enabled ? (
        <Text style={[type.body, styles.muted]}>
          {t("loan.closed", { mfi })}
        </Text>
      ) : null}

      {/* D122, board 20: she can ask. */}
      {page.enabled && page.eligible && !latestOpen ? (
        <>
          <View style={styles.hero}>
            <View style={styles.heroOkRow}>
              <LineIcon name="check" size={16} color="#8FD3AE" />
              <Text style={styles.heroOk}>{t("loan.allMetShort")}</Text>
            </View>
            <Text style={styles.heroTitle}>
              {t("loan.canAsk", { amount: formatFcfa(page.ceilingFcfa), mfi })}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowChecks(!showChecks)}
              style={styles.heroLink}
            >
              <Text style={styles.heroLinkText}>
                {showChecks
                  ? t("loan.hideConditions")
                  : t("loan.seeConditions")}
              </Text>
            </Pressable>
          </View>
          {showChecks ? <Checks checks={page.checks} mfi={mfi} /> : null}

          <Text style={styles.q}>{t("loan.howMuch")}</Text>
          <View style={styles.stepper}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("loan.less", { amount: formatFcfa(stepF) })}
              disabled={value - stepF < 5_000}
              onPress={() => setAmount(Math.max(5_000, value - stepF))}
              style={[styles.round, value - stepF < 5_000 && styles.roundOff]}
            >
              <Text style={styles.roundText}>−</Text>
            </Pressable>
            <Text
              style={styles.stepAmount}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {formatFcfa(value).replace(" FCFA", " F")}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("loan.more", { amount: formatFcfa(stepF) })}
              disabled={value + stepF > page.ceilingFcfa}
              onPress={() => setAmount(Math.min(top, value + stepF))}
              style={[
                styles.round,
                value + stepF > page.ceilingFcfa && styles.roundOff,
              ]}
            >
              <Text style={styles.roundText}>+</Text>
            </Pressable>
          </View>

          <Text style={styles.q}>{t("loan.purposeLabel")}</Text>
          <View style={styles.purposes}>
            {PURPOSES.map((p) => (
              <Pressable
                key={p}
                accessibilityRole="button"
                accessibilityState={{ selected: purpose === p }}
                onPress={() => setPurpose(p)}
                style={[styles.purpose, purpose === p && styles.purposeOn]}
              >
                <LineIcon
                  name={
                    p === "STOCK" ? "bag" : p === "EQUIPMENT" ? "tools" : "more"
                  }
                  color={purpose === p ? colors.action : colors.ink}
                />
                <Text
                  style={[
                    styles.purposeText,
                    purpose === p && styles.purposeTextOn,
                  ]}
                >
                  {t(`loan.purpose.${p}`)}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.box}>
            <Text style={styles.boxTitle}>
              {t("loan.docsToPrepare", { count: page.documents.length })}
            </Text>
            {page.documents.map((d) => (
              <View key={d.key} style={styles.bulletRow}>
                <View style={styles.bullet} />
                <Text style={[type.small, styles.ink, styles.flex]}>
                  {d.label}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[type.small, styles.muted, styles.center]}>
            {t("loan.atAgency", { mfi })} {t("loan.shareNote", { mfi })}
          </Text>
          <PrimaryButton
            label={t("loan.sendTo", { mfi })}
            disabled={busy !== null || !valid}
            onPress={send}
          />
        </>
      ) : null}

      {/* D122, board 19: not yet. What is already fine, what is missing, the ceiling. */}
      {page.enabled && !page.eligible && !latestOpen ? (
        <>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>
              {t(page.onTimeNeeded ? "loan.almost" : "loan.notYet")}
            </Text>
            <Text style={styles.heroTitle}>
              {page.onTimeNeeded
                ? t("loan.almostTitle", { count: page.onTimeNeeded })
                : t("loan.missingTitle", { count: missing.length })}
            </Text>
            {page.onTimeNeeded ? (
              <Text style={styles.heroText}>
                {t("loan.almostText", {
                  count: page.onTimeNeeded,
                  amount: formatFcfa(page.ceilingFcfa),
                })}
              </Text>
            ) : null}
          </View>
          <Checks checks={missing} mfi={mfi} title={t("loan.stillMissing")} />
          {okChecks.length > 0 ? (
            <Checks
              checks={okChecks}
              mfi={mfi}
              title={t("loan.alreadyGood")}
              count={`${okChecks.length} / ${page.checks.length}`}
            />
          ) : null}
          <View style={styles.ceiling}>
            <Text style={styles.ceilingAmount}>
              {formatFcfa(page.ceilingFcfa).replace(" FCFA", " F")}
            </Text>
            <Text style={styles.ceilingText}>
              {t("loan.ceilingNote", { mfi })}
            </Text>
          </View>
        </>
      ) : null}
      <ErrorMessage messageKey={error} />

      {/* D121: sharing her record sits here, with the lender's conditions. */}
      <RecordShare />
    </Screen>
  );
}

// A list of the MFI's conditions, each with her own figure (D91).
function Checks({
  checks,
  mfi,
  title,
  count,
}: {
  checks: LoanCheck[];
  mfi: string;
  title?: string;
  count?: string;
}) {
  const { t } = useTranslation();
  if (checks.length === 0) return null;
  return (
    <View style={styles.checks}>
      <View style={styles.checksHead}>
        <Text style={styles.boxTitle}>
          {title ?? t("loan.conditions", { mfi })}
        </Text>
        {count ? (
          <Text style={[styles.boxTitle, styles.ok]}>{count}</Text>
        ) : null}
      </View>
      {checks.map((c) => {
        const [text, have] = checkText(t, c);
        return (
          <View key={c.key} style={styles.check}>
            <View style={[styles.mark, c.ok ? styles.markOk : styles.markNo]}>
              {c.ok ? (
                <LineIcon name="check" size={13} color={colors.white} />
              ) : (
                <Text style={styles.markNoText}>–</Text>
              )}
            </View>
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
  );
}

const styles = StyleSheet.create({
  intro: { gap: 8 },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
  ink: { color: colors.ink },
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
    gap: 6,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  docActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
  },
  docText: { flex: 1, gap: 2 },
  docLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.ink,
  },
  docStatus: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
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
    alignItems: "center",
    justifyContent: "center",
  },
  markOk: { backgroundColor: colors.paid },
  markNo: { backgroundColor: colors.card },
  checkText: { flex: 1, gap: 2 },
  checkLine: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.ink,
  },
  have: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.muted },
  flex: { flex: 1 },
  center: { textAlign: "center" },
  follow: {
    gap: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  followTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 30,
    color: colors.indigo,
  },
  steps: { gap: 0 },
  step: { flexDirection: "row", gap: 12 },
  rail: { width: 28, alignItems: "center" },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dot_done: { backgroundColor: colors.paid },
  dot_now: { backgroundColor: colors.yourTurn },
  dot_todo: { backgroundColor: colors.seatEmpty },
  dot_failed: { backgroundColor: colors.problem },
  dotText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.white },
  dotTextTodo: { color: colors.muted },
  railLine: {
    width: 3,
    flex: 1,
    minHeight: 16,
    backgroundColor: colors.seatEmpty,
  },
  railLineDone: { backgroundColor: colors.paid },
  stepBody: { flex: 1, minWidth: 0, paddingBottom: 16, gap: 2 },
  stepTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    lineHeight: 22,
    color: colors.ink,
  },
  stepSub: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  docsInStep: { gap: 10, marginTop: 8 },
  hero: {
    backgroundColor: colors.indigo,
    borderRadius: 22,
    padding: 18,
    gap: 6,
  },
  heroOkRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroOk: { fontFamily: fonts.bodyBold, fontSize: 14, color: "#8FD3AE" },
  heroKicker: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.yourTurn,
  },
  heroTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 30,
    color: colors.white,
  },
  heroText: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.onDark,
  },
  heroLink: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  heroLinkText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.white,
    textDecorationLine: "underline",
  },
  q: {
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: colors.indigo,
    marginBottom: -4,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  round: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: colors.action,
    alignItems: "center",
    justifyContent: "center",
  },
  roundOff: { borderColor: colors.line },
  roundText: {
    fontFamily: fonts.bodyBold,
    fontSize: 26,
    lineHeight: 30,
    color: colors.action,
  },
  stepAmount: {
    flex: 1,
    textAlign: "center",
    fontFamily: fonts.display,
    fontSize: 30,
    lineHeight: 38,
    color: colors.indigo,
  },
  purposes: { flexDirection: "row", gap: 8 },
  purpose: {
    flex: 1,
    minHeight: 82,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  purposeOn: {
    borderWidth: 2,
    borderColor: colors.action,
    backgroundColor: colors.mist,
  },
  purposeText: {
    textAlign: "center",
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
  },
  purposeTextOn: { color: colors.action },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 7,
    backgroundColor: colors.action,
  },
  checksHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  markNoText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.indigo,
  },
  ceiling: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.turnSoft,
  },
  ceilingAmount: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 30,
    color: colors.turnText,
  },
  ceilingText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 19,
    color: colors.turnText,
  },
});
