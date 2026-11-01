import type { NewsItem } from "@novi/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../api/client";
import { listNews } from "../../api/news";
import { BackHeader } from "../../components/BackHeader";
import { ErrorMessage } from "../../components/ErrorMessage";
import { NewsRow, newsTitle } from "../../components/hub/NewsRow";
import { Screen } from "../../components/Screen";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

// The bell and "Tout voir" (D92): everything that moved in her groups over
// the last 30 days, newest first.
export default function NewsScreen() {
  const { t } = useTranslation();
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      listNews(50)
        .then((items) => active && setNews(items))
        .catch((err) => active && setError(errorKey(err)));
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <Screen>
      <BackHeader listenText={[t("news.title"), ...(news ?? []).map((n) => newsTitle(t, n))].join(". ")} />
      <View style={styles.head}>
        <Text style={styles.title}>{t("news.title")}</Text>
        <Text style={styles.hint}>{t("news.hint")}</Text>
      </View>
      <ErrorMessage messageKey={error} />
      {news ? (
        <View style={styles.box}>
          {news.length === 0 ? (
            <Text style={styles.empty}>{t("hub.noNews")}</Text>
          ) : (
            news.map((n, i) => <NewsRow key={n.id} item={n} first={i === 0} />)
          )}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: 4 },
  title: { fontFamily: fonts.bodyBold, fontSize: 26, lineHeight: 32, color: colors.indigo },
  hint: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.muted },
  box: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 2,
  },
  empty: { fontFamily: fonts.body, fontSize: 15, color: colors.muted, paddingVertical: 14 },
});
