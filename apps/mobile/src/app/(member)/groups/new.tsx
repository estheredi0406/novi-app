import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { createGroup } from "../../../api/groups";
import { BackHeader } from "../../../components/BackHeader";
import { RulesForm } from "../../../components/RulesForm";
import { Screen } from "../../../components/Screen";
import { colors } from "../../../theme/colors";
import { type } from "../../../theme/typography";

// Creating a group. It starts as a draft: nobody is told anything until she
// invites numbers and sends the rules.
export default function NewGroupScreen() {
  const { t } = useTranslation();

  return (
    <Screen>
      <BackHeader listenText={`${t("newGroup.title")}. ${t("newGroup.lede")}`} />
      <View style={styles.intro}>
        <Text style={[type.display, styles.indigo]}>{t("newGroup.title")}</Text>
        <Text style={[type.body, styles.muted]}>{t("newGroup.lede")}</Text>
      </View>
      <RulesForm
        withName
        submitLabel={t("newGroup.create")}
        onSubmit={async ({ name, ...rules }) => {
          const group = await createGroup({ name, ...rules });
          router.replace({ pathname: "/groups/[id]", params: { id: group.id } });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: 10 },
  indigo: { color: colors.indigo },
  muted: { color: colors.muted },
});
