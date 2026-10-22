import type { GroupSummary, Invitation } from "@novi/shared";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../api/client";
import { listMyGroups, listMyInvitations } from "../../api/groups";
import { ErrorMessage } from "../../components/ErrorMessage";
import { ListenButton } from "../../components/ListenButton";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { TextButton } from "../../components/TextButton";
import { rulesSummary, stateLabel } from "../../lib/rulesText";
import { useSession } from "../../session/SessionProvider";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// Home: the invitations waiting for her answer, then her groups. There is no
// search and no list of other groups: she sees a group only when its
// organiser has invited her number (D40).
export default function HomeScreen() {
  const { t } = useTranslation();
  const { member, lock } = useSession();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reloads every time home comes back into view, for example after she
  // answers an invitation or creates a group.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        try {
          const [nextInvitations, nextGroups] = await Promise.all([listMyInvitations(), listMyGroups()]);
          if (!active) return;
          setInvitations(nextInvitations);
          setGroups(nextGroups);
          setError(null);
        } catch (err) {
          if (active) setError(errorKey(err));
        } finally {
          if (active) setLoaded(true);
        }
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  if (!member) return null;

  // Logging out locks Novi on this phone, then opens the PIN screen. Going
  // there directly, instead of letting the app fall back to whatever screen
  // came before home, means she never lands back inside sign-up.
  async function logOut() {
    await lock();
    router.replace("/login");
  }

  const greeting = t("home.greeting", { name: member.displayName });
  const empty = loaded && invitations.length === 0 && groups.length === 0;

  return (
    <Screen>
      <View style={styles.top}>
        <ListenButton text={`${greeting}. ${empty ? t("home.empty") : ""}`} />
      </View>

      <Text style={[type.display, styles.indigo]}>{greeting}</Text>
      <ErrorMessage messageKey={error} />

      {invitations.length > 0 ? (
        <View style={styles.section}>
          <Text style={[type.title, styles.ink]}>{t("home.invitations")}</Text>
          {invitations.map((invitation) => (
            <Pressable
              key={invitation.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/invitations/[id]", params: { id: invitation.id } })}
              style={[styles.card, styles.invitation]}
            >
              <Text style={[type.body, styles.ink]}>
                {t("home.invitedBy", { organiser: invitation.organiserName, group: invitation.groupName })}
              </Text>
              <Text style={[type.small, styles.muted]}>{rulesSummary(t, invitation.rules)}</Text>
              <Text style={styles.cta}>{t("home.readAndAnswer")}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {groups.length > 0 ? (
        <View style={styles.section}>
          <Text style={[type.title, styles.ink]}>{t("home.groups")}</Text>
          {groups.map((group) => (
            <Pressable
              key={group.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/groups/[id]", params: { id: group.id } })}
              style={styles.card}
            >
              <View style={styles.cardTop}>
                <Text style={[type.body, styles.name]}>{group.name}</Text>
                <Text style={styles.state}>{stateLabel(t, group.state)}</Text>
              </View>
              <Text style={[type.small, styles.muted]}>{rulesSummary(t, group)}</Text>
              {group.myRole === "ORGANISER" ? <Text style={styles.tag}>{t("home.youOrganise")}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {empty ? <Text style={[type.body, styles.muted]}>{t("home.empty")}</Text> : null}

      <View style={styles.footer}>
        <PrimaryButton label={t("home.create")} onPress={() => router.push("/groups/new")} />
        {/* Development only: the ID card barcode test (D35). */}
        {__DEV__ ? <TextButton label={t("idScan.title")} onPress={() => router.push("/id-scan-test")} /> : null}
        <TextButton label={t("home.logout")} onPress={() => void logOut()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", justifyContent: "flex-end" },
  indigo: { color: colors.indigo },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
  section: { gap: 12 },
  card: { gap: 6, padding: 18, borderRadius: 18, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.white },
  invitation: { borderColor: colors.action },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  name: { flex: 1, fontFamily: fonts.bodyBold, color: colors.ink },
  state: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.indigo },
  tag: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.muted },
  cta: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.action },
  footer: { marginTop: "auto", gap: 8 },
});
