import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { updateProfile } from "../../api/auth";
import { errorKey } from "../../api/client";
import { BackHeader } from "../../components/BackHeader";
import { Chip } from "../../components/Chip";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Field } from "../../components/Field";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { AREAS, MARKETS } from "../../lib/places";
import { useSession } from "../../session/SessionProvider";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// "OTHER" means she types the name; "NONE" means she does not trade in a market.
const OTHER = "OTHER";
const NONE = "NONE";

// Where she trades, changed after sign-up: the same choices as at sign-up
// (area required, market optional, D13). Her groups see it next to her name.
export default function MePlaceScreen() {
  const { t } = useTranslation();
  const { member, setMember } = useSession();
  const startArea = member?.area ?? "";
  const startMarket = member?.market ?? null;
  const [area, setArea] = useState<string>(AREAS.includes(startArea) ? startArea : OTHER);
  const [otherArea, setOtherArea] = useState(AREAS.includes(startArea) ? "" : startArea);
  const [market, setMarket] = useState<string>(
    startMarket === null ? NONE : MARKETS.includes(startMarket) ? startMarket : OTHER,
  );
  const [otherMarket, setOtherMarket] = useState(
    startMarket !== null && !MARKETS.includes(startMarket) ? startMarket : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!member) return null;

  const chosenArea = area === OTHER ? otherArea.trim() : area;
  const chosenMarket = market === NONE ? null : market === OTHER ? otherMarket.trim() : market;
  // The API asks for at least 2 letters for an area or market name.
  const isComplete = chosenArea.length >= 2 && (chosenMarket === null || chosenMarket.length >= 2);
  const unchanged = chosenArea === member.area && chosenMarket === member.market;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await setMember(await updateProfile({ area: chosenArea, market: chosenMarket }));
      router.back();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <BackHeader listenText={`${t("me.place")}. ${t("profile.area")} ${t("profile.market")} ${t("profile.privacy")}`} />
      <Text style={[type.display, styles.indigo]}>{t("me.place")}</Text>

      <View style={styles.group}>
        <Text style={styles.label}>{t("profile.area")}</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          {AREAS.map((name) => (
            <Chip key={name} label={name} selected={area === name} onPress={() => setArea(name)} />
          ))}
          <Chip label={t("profile.otherArea")} selected={area === OTHER} onPress={() => setArea(OTHER)} />
        </View>
        {area === OTHER ? (
          <Field
            label={t("profile.otherArea")}
            placeholder={t("profile.otherAreaPlaceholder")}
            value={otherArea}
            onChangeText={setOtherArea}
            maxLength={60}
          />
        ) : null}
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>{t("profile.market")}</Text>
        <View style={styles.chips} accessibilityRole="radiogroup">
          <Chip label={t("profile.noMarket")} selected={market === NONE} onPress={() => setMarket(NONE)} />
          {MARKETS.map((name) => (
            <Chip key={name} label={name} selected={market === name} onPress={() => setMarket(name)} />
          ))}
          <Chip label={t("profile.otherMarket")} selected={market === OTHER} onPress={() => setMarket(OTHER)} />
        </View>
        {market === OTHER ? (
          <Field
            label={t("profile.otherMarket")}
            placeholder={t("profile.otherMarketPlaceholder")}
            value={otherMarket}
            onChangeText={setOtherMarket}
            maxLength={60}
          />
        ) : null}
      </View>

      <Text style={[type.small, styles.muted]}>{t("profile.privacy")}</Text>
      <ErrorMessage messageKey={error} />
      <PrimaryButton
        label={t("me.save")}
        onPress={() => void save()}
        disabled={saving || !isComplete || unchanged}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  group: { gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
