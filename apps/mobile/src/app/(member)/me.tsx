import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { BottomBar } from "../../components/BottomBar";
import { HeaderBand } from "../../components/HeaderBand";
import { LanguageSwitch } from "../../components/LanguageSwitch";
import { ListenButton } from "../../components/ListenButton";
import { Screen } from "../../components/Screen";
import { TextButton } from "../../components/TextButton";
import { formatPhone } from "../../lib/format";
import { useSession } from "../../session/SessionProvider";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// Me: who she is in Novi, her language, and logging out. Moved here from
// home in the redesign (25 Oct) so home only shows her money.
export default function MeScreen() {
  const { t } = useTranslation();
  const { member, phone, lock } = useSession();
  if (!member) return null;

  // Logging out locks Novi on this phone, then opens the PIN screen directly,
  // so she never lands back inside sign-up.
  async function logOut() {
    await lock();
    router.replace("/login");
  }

  const where = [member.area, member.market].filter(Boolean).join(" · ");

  return (
    <Screen
      bar={<BottomBar active="me" />}
      top={
        <HeaderBand>
          <View style={styles.top}>
            <ListenButton text={`${member.displayName}. ${where}`} />
          </View>
          <View style={styles.who}>
            <View style={styles.avatar}>
              <Text style={styles.initial}>{member.displayName.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.whoText}>
              <Text style={styles.name}>{member.displayName}</Text>
              {phone ? <Text style={styles.detail}>{formatPhone(phone)}</Text> : null}
              {where ? <Text style={styles.detail}>{where}</Text> : null}
            </View>
          </View>
        </HeaderBand>
      }
    >
      <Text style={[type.small, styles.section]}>{t("me.language")}</Text>
      <LanguageSwitch />

      <View style={styles.footer}>
        {/* Development only: the ID card barcode test (D35). */}
        {__DEV__ ? <TextButton label={t("idScan.title")} onPress={() => router.push("/id-scan-test")} /> : null}
        <TextButton label={t("home.logout")} onPress={() => void logOut()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", justifyContent: "flex-end" },
  who: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { fontFamily: fonts.display, fontSize: 28, color: colors.white },
  whoText: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.indigo },
  detail: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.muted },
  section: { color: colors.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  footer: { marginTop: "auto", gap: 12 },
});
