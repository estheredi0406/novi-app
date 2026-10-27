import { Redirect, router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { register } from "../../api/auth";
import { ApiError, errorKey } from "../../api/client";
import { Chip } from "../../components/Chip";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Field } from "../../components/Field";
import { PrimaryButton } from "../../components/PrimaryButton";
import { Screen } from "../../components/Screen";
import { AuthBand } from "../../components/AuthBand";
import { currentLanguage } from "../../i18n";
import { useSession } from "../../session/SessionProvider";
import { useSignUp } from "../../signup/SignUpContext";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// Lomé neighbourhoods and markets offered as one-tap choices. Anything else
// is typed in, so nobody is left out because her place is not listed.
const AREAS = ["Bè", "Agoè", "Adidogomé", "Hédzranawoé"];
const MARKETS = ["Assigamé", "Hédzranawoé"];

// "OTHER" means she types the name; "NONE" means she does not trade in a market.
const OTHER = "OTHER";
const NONE = "NONE";

// Screen A8: how her group knows her, then the account is created.
// Area is required, market is optional (D13). Her legal name came from ANID.
export default function ProfileScreen() {
  const { t } = useTranslation();
  const { draft, reset } = useSignUp();
  const { open } = useSession();
  const [displayName, setDisplayName] = useState("");
  const [area, setArea] = useState<string | null>(null);
  const [otherArea, setOtherArea] = useState("");
  const [market, setMarket] = useState<string>(NONE);
  const [otherMarket, setOtherMarket] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  // Arriving here without a PIN (for example after a reload) goes back a step.
  if (!draft.pin || !draft.identityToken || !draft.verificationToken || !draft.phone) {
    return <Redirect href="/pin" />;
  }
  const { pin, identityToken, verificationToken, phone } = draft;

  const chosenArea = area === OTHER ? otherArea.trim() : (area ?? "");
  const chosenMarket = market === NONE ? null : market === OTHER ? otherMarket.trim() : market;
  // The API asks for at least 2 letters for an area or market name.
  const isComplete =
    displayName.trim().length > 0 && chosenArea.length >= 2 && (chosenMarket === null || chosenMarket.length >= 2);

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const auth = await register({
        verificationToken,
        identityToken,
        pin,
        displayName: displayName.trim(),
        area: chosenArea,
        market: chosenMarket,
        language: currentLanguage(),
        acceptedTerms: draft.acceptedTerms ?? false,
        acceptedCreditDataUse: draft.acceptedCreditDataUse ?? false,
      });
      await open(auth, phone);
      router.replace("/home");
    } catch (err) {
      // The phone and ID stamps last only minutes. If they ran out, the
      // checks must be done again; nothing was created.
      if (err instanceof ApiError && err.status === 401) {
        setExpired(true);
        return;
      }
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    reset();
    router.replace("/phone");
  }

  if (expired) {
    return (
      <Screen top={<AuthBand step={6} title={t("profile.expired")} listenText={t("profile.expired")} />}>
        <View style={styles.footer}>
          <PrimaryButton label={t("profile.restart")} onPress={restart} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      top={
        <AuthBand
          step={6}
          eyebrow={t("profile.step")}
          title={t("profile.title")}
          listenText={`${t("profile.title")}. ${t("profile.privacy")}`}
        />
      }
    >
      <Field label={t("profile.displayName")} value={displayName} onChangeText={setDisplayName} maxLength={60} />

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
            autoFocus
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
            autoFocus
          />
        ) : null}
      </View>

      <Text style={[type.small, styles.muted]}>{t("profile.privacy")}</Text>
      <ErrorMessage messageKey={error} />

      <View style={styles.footer}>
        <PrimaryButton label={t("profile.finish")} onPress={() => void finish()} disabled={!isComplete || busy} />
        <Pressable accessibilityRole="button" onPress={restart} style={styles.secondary}>
          <Text style={styles.link}>{t("profile.restart")}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 10 },
  eyebrow: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.action },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  group: { gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  footer: { marginTop: "auto", gap: 12 },
  secondary: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  link: { fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.action },
});