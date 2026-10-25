import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { updateProfile } from "../../api/auth";
import { errorKey } from "../../api/client";
import { BackHeader } from "../../components/BackHeader";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Field } from "../../components/Field";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { useSession } from "../../session/SessionProvider";
import { colors } from "../../theme/colors";
import { type } from "../../theme/typography";

// The name her groups see. Her legal name, checked with ANID, never changes
// here (D15): only this display name.
export default function MeNameScreen() {
  const { t } = useTranslation();
  const { member, setMember } = useSession();
  const [name, setName] = useState(member?.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!member) return null;

  const trimmed = name.trim();

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await setMember(await updateProfile({ displayName: trimmed }));
      router.back();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <BackHeader listenText={`${t("me.name")}. ${t("me.nameHint")}`} />
      <View style={styles.intro}>
        <Text style={[type.display, styles.indigo]}>{t("me.name")}</Text>
        <Text style={[type.body, styles.muted]}>{t("me.nameHint")}</Text>
      </View>
      <Field label={t("me.name")} value={name} onChangeText={setName} maxLength={60} autoCapitalize="words" />
      <ErrorMessage messageKey={error} />
      <PrimaryButton
        label={t("me.save")}
        onPress={() => void save()}
        disabled={saving || trimmed.length === 0 || trimmed === member.displayName}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 8 },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
});
