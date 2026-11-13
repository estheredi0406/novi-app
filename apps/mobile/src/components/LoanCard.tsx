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

// The loan request on home (D89), shown only when it matters: she can ask,
// or the MFI is studying, has kept or has answered her request.
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
  if (latest?.status === "GRANTED" && recentDays <= 30) {
    title = t("loan.granted", { amount: formatFcfa(latest.grantedFcfa ?? latest.amountFcfa) });
    sub = t("loan.grantedSub");
    tone = "ok";
  } else if (latest?.status === "PRESELECTED") {
    title = t("loan.cardToSign");
    sub = t("loan.cardToSignSub", { mfi });
    tone = "offer";
  } else if (latest?.status === "PENDING") {
    title = t("loan.cardPending", { mfi });
    sub = t("loan.cardPendingSub");
  } else if ((latest?.status === "DECLINED" || latest?.status === "NOT_GRANTED") && recentDays <= 7) {
    title = latest.status === "DECLINED" ? t("loan.declined") : t("loan.notGranted");
    sub = latest.decisionNote ?? t("loan.cardSee");
  } else if (page.eligible) {
    title = t("loan.cardOffer", { amount: formatFcfa(page.ceilingFcfa) });
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
