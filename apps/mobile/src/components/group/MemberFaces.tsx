import type { RoundPayment } from "@novi/shared";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

// Who has paid this round, as faces in turn order (D92, board E5): the same
// order as the ring on home, so seat 6 there is the sixth face here. Green
// with a tick when paid, turquoise when the caisse paid her share (D68), a
// blue ring while a payment is being confirmed, her own face in dashed orange
// while she still owes, and a saffron ring around whoever receives the pot.
export function MemberFaces({
  payments,
  memberId,
  receiverIndex,
}: {
  payments: RoundPayment[];
  memberId: string;
  receiverIndex: number | null; // from 0
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.grid}>
      {payments.map((p, i) => {
        const me = p.memberId === memberId;
        const paid = p.status === "PAID";
        const covered = p.coveredByReserve && !paid;
        const pending = p.status === "PENDING";
        const receives = i === receiverIndex;
        const name = me ? t("groupView.you") : p.displayName.split(" ")[0];
        const state = paid
          ? t("groupView.paid")
          : covered
            ? t("groupView.coveredTag")
            : pending
              ? t("groupView.onItsWay")
              : me
                ? t("groupView.toPay")
                : t("groupView.notYet");
        return (
          <View
            key={p.memberId}
            style={styles.cell}
            accessible
            accessibilityLabel={`${me ? t("groupView.you") : p.displayName}, ${state}`}
          >
            <View style={[styles.halo, receives && styles.haloOn]}>
              <View
                style={[
                  styles.face,
                  paid && styles.paid,
                  covered && styles.covered,
                  pending && styles.pending,
                  me && !paid && !covered && !pending && styles.mine,
                ]}
              >
                <Text style={[styles.initial, (paid || covered) && styles.initialOn, me && !paid && styles.initialMine]}>
                  {paid || covered ? "✓" : initials(p.displayName)}
                </Text>
              </View>
            </View>
            <Text style={[styles.name, me && styles.nameMine]} numberOfLines={1}>
              {name}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 14 },
  cell: { width: "16.66%", alignItems: "center", gap: 3 },
  halo: { padding: 2, borderRadius: 24, borderWidth: 2.5, borderColor: "transparent" },
  haloOn: { borderColor: colors.yourTurn },
  face: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  paid: { backgroundColor: colors.paid, borderColor: colors.paid },
  covered: { backgroundColor: colors.teal, borderColor: colors.teal },
  pending: { borderColor: colors.lagoon },
  mine: { borderColor: colors.accent, borderStyle: "dashed", borderWidth: 2.5 },
  initial: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.muted },
  initialOn: { color: colors.white, fontSize: 16 },
  initialMine: { color: colors.accent },
  name: { fontFamily: fonts.body, fontSize: 11, color: colors.ink, maxWidth: "95%" },
  nameMine: { fontFamily: fonts.bodyBold, color: colors.accent },
});
