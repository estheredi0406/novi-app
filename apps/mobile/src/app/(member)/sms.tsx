import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../api/client";
import { getMySms, type PilotSms } from "../../api/config";
import { BackHeader } from "../../components/BackHeader";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Screen } from "../../components/Screen";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

// "Mes SMS (pilote)" (D111): on the pilot server, the SMS her phone would
// receive, written as they are sent, newest first. Real ones (Pindo, to a
// Rwandan number) and simulated ones are marked, so testers and the jury see
// exactly what a member without the app is told.
export default function SmsScreen() {
  const { t, i18n } = useTranslation();
  const [messages, setMessages] = useState<PilotSms[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locale = i18n.language === "en" ? "en-GB" : "fr-FR";

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getMySms()
        .then((r) => active && setMessages(r.messages))
        .catch((err) => active && setError(errorKey(err)));
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <Screen>
      <BackHeader listenText={[t("sms.title"), ...(messages ?? []).map((m) => m.text)].join(". ")} />
      <View style={styles.head}>
        <Text style={styles.title}>{t("sms.title")}</Text>
        <Text style={styles.hint}>{t("sms.hint")}</Text>
      </View>
      <ErrorMessage messageKey={error} />
      {messages && messages.length === 0 ? <Text style={styles.empty}>{t("sms.empty")}</Text> : null}
      <View style={styles.list}>
        {(messages ?? []).map((m) => (
          <View key={m.id} style={styles.item}>
            <Text style={styles.time}>
              {new Date(m.at).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              {" · "}
              {m.real ? t("sms.real") : t("sms.simulated")}
            </Text>
            <View style={styles.bubble}>
              <Text style={styles.text}>{m.text}</Text>
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: 4 },
  title: { fontFamily: fonts.bodyBold, fontSize: 26, lineHeight: 32, color: colors.indigo },
  hint: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.muted },
  empty: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  list: { gap: 14 },
  item: { gap: 4 },
  time: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  bubble: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  text: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink },
});
