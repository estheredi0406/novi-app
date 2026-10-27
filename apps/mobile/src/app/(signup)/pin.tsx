import { isWeakPin } from "@novi/shared";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Screen } from "../../components/Screen";
import { AuthBand } from "../../components/AuthBand";
import { PinCowries } from "../../components/PinCowries";
import { useSignUp } from "../../signup/SignUpContext";
import { colors } from "../../theme/colors";
import { fonts, type } from "../../theme/typography";

// Screen A7: she chooses a PIN, then types it again. Easy PINs are refused
// here at once, with the same rule the API enforces (D16).
export default function PinScreen() {
  const { t } = useTranslation();
  const { draft, update } = useSignUp();
  const [first, setFirst] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!draft.identityToken) return <Redirect href="/identity" />;

  const confirming = first !== null;

  function onChange(input: string) {
    const digits = input.replace(/\D/g, "").slice(0, 4);
    setValue(digits);
    if (digits.length < 4) return;

    if (!confirming) {
      if (isWeakPin(digits)) {
        setError("auth.pinTooWeak");
        setValue("");
        return;
      }
      setError(null);
      setFirst(digits);
      setValue("");
      return;
    }

    if (digits !== first) {
      setError("pin.mismatch");
      setFirst(null);
      setValue("");
      return;
    }
    update({ pin: digits });
    router.push("/profile");
  }

  const title = confirming ? t("pin.confirmTitle") : t("pin.createTitle");

  return (
    <Screen
      top={
        <AuthBand
          step={5}
          eyebrow={t("pin.step")}
          title={title}
          lede={t("pin.lede")}
          listenText={`${title}. ${t("pin.lede")} ${t("pin.tip")}`}
        />
      }
    >
      <PinCowries key={confirming ? "confirm" : "create"} label={title} value={value} onChangeText={onChange} autoFocus />

      <ErrorMessage messageKey={error} />
      <View style={styles.note}>
        <Text style={[type.small, styles.ink]}>{t("pin.tip")}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 10 },
  eyebrow: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.action },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
  ink: { color: colors.ink },
  pinInput: { fontSize: 32, letterSpacing: 16, textAlign: "center" },
  note: { padding: 16, borderRadius: 14, backgroundColor: colors.mist },
});