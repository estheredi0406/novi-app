import { type Href, router } from "expo-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { BottomBar } from "../../components/BottomBar";
import { HeaderBand } from "../../components/HeaderBand";
import { LanguageSwitch } from "../../components/LanguageSwitch";
import { ListenButton } from "../../components/ListenButton";
import { Screen } from "../../components/Screen";
import { TextButton } from "../../components/TextButton";
import { Glyph } from "../../components/art/Glyph";
import { formatPhone } from "../../lib/format";
import { useSession } from "../../session/SessionProvider";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

// Me, as on the approved "Me: wax" board: who she is, her language, the
// things she may change, and logging out. The FUCEC agency map row waits for
// the map itself (no link that leads nowhere).
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

  // A new PIN is confirmed by SMS code, as when it is forgotten: Novi locks,
  // then opens that flow; she logs in again with the new PIN.
  function changePin() {
    Alert.alert(t("me.pinTitle"), t("me.pinBody"), [
      { text: t("common.back"), style: "cancel" },
      {
        text: t("me.pinGo"),
        onPress: () =>
          void (async () => {
            await lock();
            router.replace("/forgot-pin");
          })(),
      },
    ]);
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
            <View style={styles.avatarWrap}>
              <View style={styles.avatarShadow} />
              <View style={styles.avatar}>
                <Text style={styles.initial}>{member.displayName.slice(0, 1).toUpperCase()}</Text>
              </View>
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
      <LanguageSwitch />

      <View style={styles.cardWrap}>
        <View style={styles.cardShadow} />
        <View style={styles.card}>
          <Row
            icon={
              <Path d="M4 7 H20 M4 12 H20 M4 17 H14" stroke={colors.indigo} strokeWidth={1.8} strokeLinecap="round" />
            }
            label={t("me.name")}
            sub={member.displayName}
            onPress={() => router.push("/me-name" as Href)}
          />
          <Row
            icon={
              <Path
                d="M7 11 H17 V19 H7 Z M9 11 V8 A3 3 0 0 1 15 8 V11"
                stroke={colors.indigo}
                strokeWidth={1.8}
                fill={colors.teal}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            }
            label={t("me.pin")}
            onPress={changePin}
          />
          <Row
            icon={
              <>
                <Circle cx={9} cy={8} r={3} stroke={colors.indigo} strokeWidth={1.8} fill={colors.mist} />
                <Path
                  d="M3 19 C3 15 6 13 9 13 C12 13 15 15 15 19 M16 7 L18 9 L22 5"
                  stroke={colors.indigo}
                  strokeWidth={1.8}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            }
            label={t("kin.title")}
            sub={member.nextOfKin ? `${member.nextOfKin.name} · ${member.nextOfKin.relation}` : t("kin.notSet")}
            onPress={() => router.push("/me-kin" as Href)}
          />
          <Row
            icon={
              <>
                <Path
                  d="M5 4 H14 L19 9 V20 H5 Z M14 4 V9 H19"
                  stroke={colors.indigo}
                  strokeWidth={1.8}
                  fill={colors.shell}
                  strokeLinejoin="round"
                />
                <Circle cx={10} cy={14} r={1.6} fill={colors.accent} />
              </>
            }
            label={t("me.agreed")}
            onPress={() => router.push("/me-agreed" as Href)}
            last
          />
        </View>
      </View>

      <View style={styles.footer}>
        <Pressable accessibilityRole="button" onPress={() => void logOut()} style={styles.logout}>
          <Text style={styles.logoutText}>{t("home.logout")}</Text>
        </Pressable>
        {/* Development only: the ID card barcode test (D35). */}
        {__DEV__ ? <TextButton label={t("idScan.title")} onPress={() => router.push("/id-scan-test")} /> : null}
      </View>
    </Screen>
  );
}

function Row({
  icon,
  label,
  sub,
  onPress,
  last = false,
}: {
  icon: ReactNode;
  label: string;
  sub?: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.row, !last && styles.rowLine]}>
      <View style={styles.rowIcon}>
        <Svg width={20} height={20} viewBox="0 0 24 24">
          {icon}
        </Svg>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      <Glyph name="chevron" color={colors.indigo} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", justifyContent: "flex-end" },
  who: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatarWrap: { paddingRight: 3, paddingBottom: 3 },
  avatarShadow: {
    position: "absolute",
    top: 3,
    left: 3,
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.indigo,
  },
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
  cardWrap: { paddingRight: 3, paddingBottom: 3 },
  cardShadow: {
    position: "absolute",
    top: 3,
    left: 3,
    right: 0,
    bottom: 0,
    borderRadius: 22,
    backgroundColor: colors.indigo,
  },
  card: {
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 60,
  },
  rowLine: { borderBottomWidth: 1, borderBottomColor: colors.line },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.mist,
    borderWidth: 1.2,
    borderColor: colors.indigo,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 1 },
  rowLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  rowSub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  footer: { marginTop: "auto", gap: 8, alignItems: "center" },
  logout: {
    minHeight: 48,
    paddingHorizontal: 28,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.accent,
    justifyContent: "center",
  },
  // Orange like the other main buttons: red stays for money problems only.
  logoutText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.white },
});
