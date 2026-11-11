import type { LoanPage } from "@novi/shared";
import { type Href, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getLoans } from "../api/help";
import { formatFcfa } from "../lib/format";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { Glyph } from "./art/Glyph";

// D89: where she meets the loan request. On home it appears only when it
// matters: her record now opens a request, or the MFI has answered or is
// studying hers. On her record ("always"), it is always there, since her
// record is what opens the door: the button when she qualifies, otherwise
// a link to the conditions.
export function LoanCard({ always = false }: { always?: boolean }) {
  const { t } = useTranslation();
  const [page, setPage] = useState<LoanPage | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getLoans().then(
        (p) => active && setPage(p),
        () => undefined, // the card simply stays hidden
      );
      return () => {
        active = false;
      };
    }, []),
  );

  if (!page) return null;
  const mfi = page.mfiName ?? t("loan.yourMfi");
  const latest = page.requests[0];
  const recentDays = latest
    ? (Date.now() - new Date(latest.decidedAt ?? latest.createdAt).getTime()) /
      86_400_000
    : 99;

  let title: string;
  let sub: string;
  let tone: "offer" | "ok" | "plain" = "plain";
  if (
    (latest?.status === "APPROVED" || latest?.status === "GRANTED") &&
    recentDays <= 30
  ) {
    title = t("loan.approved", {
      amount: formatFcfa(latest.grantedFcfa ?? latest.amountFcfa),
    });
    sub =
      latest.status === "APPROVED"
        ? t("loan.goToAgency", { mfi })
        : t("loan.grantedSub");
    tone = "ok";
  } else if (latest?.status === "PRESELECTED") {
    const toDo = latest.documents.filter(
      (d) => d.status === "MISSING" || d.status === "REDO",
    ).length;
    title = latest.documentsComplete
      ? t("loan.fileComplete")
      : t("loan.preselected");
    sub = latest.documentsComplete
      ? t("loan.fileCompleteSub", { mfi })
      : toDo > 0
        ? t("loan.cardDocsToSend", { count: toDo })
        : t("loan.docStatus.SENT", { mfi });
    tone = latest.documentsComplete ? "ok" : "offer";
  } else if (latest?.status === "PENDING") {
    title = t("loan.pending", { mfi });
    sub = t("loan.cardPendingSub");
  } else if (
    (latest?.status === "DECLINED" || latest?.status === "NOT_GRANTED") &&
    recentDays <= 7
  ) {
    title =
      latest.status === "DECLINED" ? t("loan.declined") : t("loan.notGranted");
    sub = latest.decisionNote ?? t("loan.cardSee");
  } else if (page.eligible) {
    title = t("loan.cardOffer", { mfi, amount: formatFcfa(page.ceilingFcfa) });
    sub = t("loan.cardOfferSub");
    tone = "offer";
  } else if (always) {
    title = t("loan.title", { mfi });
    sub = t("loan.cardConditions");
  } else {
    return null;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
      onPress={() => router.push("/loan" as Href)}
      style={[
        styles.card,
        tone === "offer" && styles.offer,
        tone === "ok" && styles.ok,
      ]}
    >
      <View style={styles.text}>
        <Text style={[styles.title, tone === "offer" && styles.onDark]}>
          {title}
        </Text>
        <Text style={[styles.sub, tone === "offer" && styles.onDarkSoft]}>
          {sub}
        </Text>
      </View>
      <Glyph
        name="chevron"
        color={tone === "offer" ? colors.white : colors.indigo}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  offer: { backgroundColor: colors.indigo },
  ok: { borderColor: colors.paid, backgroundColor: colors.paidSoft },
  text: { flex: 1, gap: 4 },
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: 17,
    lineHeight: 23,
    color: colors.indigo,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
  },
  onDark: { color: colors.white },
  onDarkSoft: { color: colors.mist },
});
