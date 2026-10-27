import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, StyleSheet, Text, View } from "react-native";
import { updateProfile } from "../../api/auth";
import { errorKey } from "../../api/client";
import { BackHeader } from "../../components/BackHeader";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Field } from "../../components/Field";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { TextButton } from "../../components/TextButton";
import { useSession } from "../../session/SessionProvider";
import { colors } from "../../theme/colors";
import { type } from "../../theme/typography";

// Her next of kin (D69): the person the MFI pays what she is owed if she
// dies (her pot, if her turn has not come, and her part of the reserve), on
// a death certificate. Novi never contacts this person while she is alive.
export default function MeKinScreen() {
  const { t } = useTranslation();
  const { member, setMember } = useSession();
  const kin = member?.nextOfKin ?? null;
  const [name, setName] = useState(kin?.name ?? "");
  const [relation, setRelation] = useState(kin?.relation ?? "");
  const [digits, setDigits] = useState(kin?.phone.replace("+228", "") ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!member) return null;

  const phone = `+228${digits}`;
  const ready = name.trim().length >= 2 && relation.trim().length >= 2 && /^\d{8}$/.test(digits);
  const unchanged =
    kin !== null && kin.name === name.trim() && kin.relation === relation.trim() && kin.phone === phone;

  async function save(next: { name: string; relation: string; phone: string } | null) {
    setSaving(true);
    setError(null);
    try {
      await setMember(await updateProfile({ nextOfKin: next }));
      router.back();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setSaving(false);
    }
  }

  function remove() {
    Alert.alert(t("kin.removeTitle"), t("kin.removeBody"), [
      { text: t("kin.keep"), style: "cancel" },
      { text: t("kin.remove"), style: "destructive", onPress: () => void save(null) },
    ]);
  }

  return (
    <Screen>
      <BackHeader listenText={`${t("kin.title")}. ${t("kin.why")} ${t("kin.private")}`} />
      <View style={styles.intro}>
        <Text style={[type.display, styles.indigo]}>{t("kin.title")}</Text>
        <Text style={[type.body, styles.muted]}>{t("kin.why")}</Text>
        <Text style={[type.body, styles.muted]}>{t("kin.private")}</Text>
      </View>
      <Field label={t("kin.name")} value={name} onChangeText={setName} maxLength={80} autoCapitalize="words" />
      <Field
        label={t("kin.relation")}
        placeholder={t("kin.relationExample")}
        value={relation}
        onChangeText={setRelation}
        maxLength={40}
        autoCapitalize="sentences"
      />
      <Field
        label={t("kin.phone")}
        prefix="+228"
        value={digits}
        onChangeText={(text) => setDigits(text.replace(/\D/g, "").slice(0, 8))}
        keyboardType="number-pad"
        maxLength={8}
      />
      <ErrorMessage messageKey={error} />
      <PrimaryButton
        label={t("me.save")}
        onPress={() => void save({ name: name.trim(), relation: relation.trim(), phone })}
        disabled={saving || !ready || unchanged}
      />
      {kin ? <TextButton label={t("kin.remove")} onPress={remove} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 8 },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
});
