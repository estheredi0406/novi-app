import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ListenButton } from "../components/ListenButton";
import { PrimaryButton } from "../components/PrimaryButton";
import { Screen } from "../components/Screen";
import { useSession } from "../session/SessionProvider";
import { colors } from "../theme/colors";
import { fonts, type } from "../theme/typography";

// First home screen: proves sign-up opened her account. Groups replace the
// middle of this screen in Sprint 2.
export default function HomeScreen() {
  const { t } = useTranslation();
  const { member, lock } = useSession();
  if (!member) return null;

  const greeting = t("home.greeting", { name: member.displayName });
  const place = member.market ? `${member.area} · ${member.market}` : member.area;

  return (
    <Screen>
      <View style={styles.top}>
        <ListenButton text={`${greeting}. ${t("home.open")} ${t("home.next")}`} />
      </View>

      <View style={styles.intro}>
        <Text style={[type.display, styles.indigo]}>{greeting}</Text>
        <Text style={[type.body, styles.ink]}>{t("home.open")}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{t("home.legalName")}</Text>
        <Text style={[type.body, styles.ink]}>{member.legalName}</Text>
        <Text style={styles.label}>{t("home.area")}</Text>
        <Text style={[type.body, styles.ink]}>{place}</Text>
      </View>

      <Text style={[type.small, styles.muted]}>{t("home.next")}</Text>

      <View style={styles.footer}>
        <Pressable accessibilityRole="button" onPress={() => router.push("/health")} style={styles.secondary}>
          <Text style={styles.link}>{t("home.check")}</Text>
        </Pressable>
        <PrimaryButton label={t("home.logout")} onPress={() => void lock()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", justifyContent: "flex-end" },
  intro: { gap: 10 },
  indigo: { color: colors.indigo },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.muted },
  card: { gap: 6, padding: 18, borderRadius: 18, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.white },
  footer: { marginTop: "auto", gap: 12 },
  secondary: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  link: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.action },
});