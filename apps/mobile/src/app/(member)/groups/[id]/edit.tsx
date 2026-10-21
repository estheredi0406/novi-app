import type { GroupDetail } from "@novi/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { errorKey } from "../../../../api/client";
import { getGroup, reviseRules } from "../../../../api/groups";
import { BackHeader } from "../../../../components/BackHeader";
import { ErrorMessage } from "../../../../components/ErrorMessage";
import { RulesForm } from "../../../../components/RulesForm";
import { Screen } from "../../../../components/Screen";
import { colors } from "../../../../theme/colors";
import { type } from "../../../../theme/typography";

// Changing a group's rules. Saving creates the next version, and every member
// answers again (D29): she is told before she saves.
export default function EditRulesScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getGroup(id).then(setGroup, (err: unknown) => setError(errorKey(err)));
  }, [id]);

  return (
    <Screen>
      <BackHeader listenText={`${t("editRules.title")}. ${t("editRules.lede")}`} />
      <View style={styles.intro}>
        <Text style={[type.display, styles.indigo]}>{t("editRules.title")}</Text>
        <Text style={[type.body, styles.muted]}>{t("editRules.lede")}</Text>
      </View>
      <ErrorMessage messageKey={error} />
      {group ? (
        <RulesForm
          initial={group.rules}
          withName={false}
          submitLabel={t("editRules.save")}
          onSubmit={async ({ name: _name, ...rules }) => {
            await reviseRules(id, rules);
            router.back();
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 10 },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
});
