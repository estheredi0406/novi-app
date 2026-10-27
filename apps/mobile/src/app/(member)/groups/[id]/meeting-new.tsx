import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../../../api/client";
import { scheduleMeeting } from "../../../../api/groups";
import { BackHeader } from "../../../../components/BackHeader";
import { Chip } from "../../../../components/Chip";
import { ErrorMessage } from "../../../../components/ErrorMessage";
import { Field } from "../../../../components/Field";
import { PrimaryButton } from "../../../../components/PrimaryButton";
import { Screen } from "../../../../components/Screen";
import { meetingWhen } from "../../../../lib/meetingTime";
import { colors } from "../../../../theme/colors";
import { fonts, type } from "../../../../theme/typography";

// The organiser plans a meeting (D71). The day, hour and length are chosen
// by touch, not typed: quicker, and no date format to get wrong.
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 06 h to 21 h
const QUARTERS = [0, 15, 30, 45];
const DURATIONS = [15, 30, 45, 60];

export default function NewMeetingScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const locale = i18n.language === "en" ? "en-GB" : "fr-FR";
  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: 14 }, (_, i) => new Date(today.getTime() + i * 24 * 60 * 60 * 1000));
  }, []);

  const [title, setTitle] = useState("");
  const [agenda, setAgenda] = useState("");
  const [day, setDay] = useState(1);
  const [hour, setHour] = useState(18);
  const [minute, setMinute] = useState(0);
  const [duration, setDuration] = useState(30);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = days[day] ?? days[0];
  const startsAt = new Date(chosen as Date);
  startsAt.setHours(hour, minute, 0, 0);
  const tooSoon = startsAt.getTime() < Date.now() + 5 * 60_000;

  function dayLabel(date: Date, index: number): string {
    if (index === 0) return t("meetings.today");
    if (index === 1) return t("meetings.tomorrow");
    return date.toLocaleDateString(locale, { weekday: "short", day: "numeric" });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await scheduleMeeting(id, {
        title: title.trim(),
        agenda: agenda.trim() || null,
        startsAt: startsAt.toISOString(),
        durationMin: duration,
      });
      router.back();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <BackHeader listenText={`${t("meetings.schedule")}. ${t("meetings.scheduleHint")}`} />
      <View style={styles.intro}>
        <Text style={[type.title, styles.indigo]}>{t("meetings.schedule")}</Text>
        <Text style={[type.body, styles.muted]}>{t("meetings.scheduleHint")}</Text>
      </View>

      <Field
        label={t("meetings.titleLabel")}
        placeholder={t("meetings.titleExample")}
        value={title}
        onChangeText={setTitle}
        maxLength={80}
        autoCapitalize="sentences"
      />

      <Text style={styles.label}>{t("meetings.day")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {days.map((date, index) => (
          <Chip key={date.toISOString()} label={dayLabel(date, index)} selected={day === index} onPress={() => setDay(index)} />
        ))}
      </ScrollView>

      <Text style={styles.label}>{t("meetings.hour")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {HOURS.map((h) => (
          <Chip key={h} label={`${String(h).padStart(2, "0")} h`} selected={hour === h} onPress={() => setHour(h)} />
        ))}
      </ScrollView>
      <View style={styles.row}>
        {QUARTERS.map((m) => (
          <Chip key={m} label={`:${String(m).padStart(2, "0")}`} selected={minute === m} onPress={() => setMinute(m)} />
        ))}
      </View>

      <Text style={styles.label}>{t("meetings.length")}</Text>
      <View style={styles.row}>
        {DURATIONS.map((d) => (
          <Chip key={d} label={t("meetings.minutes", { count: d })} selected={duration === d} onPress={() => setDuration(d)} />
        ))}
      </View>

      <Field
        label={t("meetings.agendaLabel")}
        placeholder={t("meetings.agendaExample")}
        value={agenda}
        onChangeText={setAgenda}
        maxLength={300}
        multiline
      />

      <View style={styles.summary}>
        <Text style={styles.summaryText}>{meetingWhen(startsAt.toISOString(), i18n.language)}</Text>
        <Text style={styles.summarySub}>{tooSoon ? t("meetings.tooSoon") : t("meetings.opensBefore")}</Text>
      </View>

      <ErrorMessage messageKey={error} />
      <PrimaryButton
        label={t("meetings.confirm")}
        onPress={() => void save()}
        disabled={saving || title.trim().length < 3 || tooSoon}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 8 },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink, marginBottom: -8 },
  chips: { gap: 8, paddingRight: 24 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  summary: {
    backgroundColor: colors.mist,
    borderRadius: 14,
    padding: 14,
    gap: 4,
    borderWidth: 1.5,
    borderColor: colors.indigo,
  },
  summaryText: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.indigo },
  summarySub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
});
