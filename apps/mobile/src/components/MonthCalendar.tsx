import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";

// "YYYY-MM-DD" of a date in the phone's own day (Lomé is on GMT all year).
export const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

// A month at a glance (approved design F5): meeting days in navy, payment
// days with an orange dot, today ringed. Weeks start on Monday, as in Togo.
export function MonthCalendar({ meetings, payments }: { meetings: Set<string>; payments: Set<string> }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-GB" : "fr-FR";
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const start = new Date(first);
  start.setDate(first.getDate() - lead);
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  // Six rows only when the month needs them.
  const weeks = (days[35] as Date).getMonth() === month.getMonth() ? 6 : 5;
  const heads = Array.from({ length: 7 }, (_, i) =>
    (days[i] as Date).toLocaleDateString(locale, { weekday: "narrow" }).toUpperCase(),
  );
  const title = month.toLocaleDateString(locale, { month: "long", year: "numeric" });

  const move = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("calendar.previous")} onPress={() => move(-1)} style={styles.arrow}>
          <Text style={styles.arrowText}>‹</Text>
        </Pressable>
        <Text style={styles.title}>{title.charAt(0).toUpperCase() + title.slice(1)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("calendar.next")} onPress={() => move(1)} style={styles.arrow}>
          <Text style={styles.arrowText}>›</Text>
        </Pressable>
      </View>
      <View style={styles.grid}>
        {heads.map((h, i) => (
          <Text key={`h${i}`} style={styles.dayHead}>
            {h}
          </Text>
        ))}
        {days.slice(0, weeks * 7).map((d) => {
          const key = dayKey(d);
          const inMonth = d.getMonth() === month.getMonth();
          const meeting = meetings.has(key);
          return (
            <View key={key} style={styles.cell}>
              <View style={[styles.num, key === dayKey(today) && styles.today, meeting && styles.meeting]}>
                <Text style={[styles.numText, !inMonth && styles.outside, meeting && styles.meetingText]}>{d.getDate()}</Text>
              </View>
              <View style={[styles.dot, payments.has(key) && styles.payDot]} />
            </View>
          );
        })}
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={styles.legendMeeting} />
          <Text style={styles.legendText}>{t("calendar.meeting")}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, styles.payDot]} />
          <Text style={styles.legendText}>{t("calendar.payment")}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderColor: colors.indigo, borderRadius: 18, backgroundColor: colors.card, padding: 14, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  arrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowText: { fontSize: 22, color: colors.indigo, marginTop: -2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.indigo },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  dayHead: { width: "14.2857%", textAlign: "center", fontFamily: fonts.bodyBold, fontSize: 12, color: colors.muted, paddingBottom: 4 },
  cell: { width: "14.2857%", alignItems: "center", gap: 1, paddingVertical: 1 },
  num: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  numText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },
  outside: { color: colors.crackle },
  today: { borderWidth: 1.5, borderColor: colors.accent },
  meeting: { backgroundColor: colors.indigo },
  meetingText: { fontFamily: fonts.bodyBold, color: colors.white },
  dot: { width: 6, height: 6, borderRadius: 3 },
  payDot: { backgroundColor: colors.accent },
  legend: { flexDirection: "row", gap: 16 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendMeeting: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.indigo },
  legendText: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
});
