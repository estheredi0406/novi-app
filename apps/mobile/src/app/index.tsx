import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "../components/PrimaryButton";
import { Screen } from "../components/Screen";
import { colors } from "../theme/colors";
import { type } from "../theme/typography";

// Temporary first screen proving the foundations: navigation, palette and
// fonts, including the Ewe letters. Replaced by language choice in S1.6d.
export default function Welcome() {
  return (
    <Screen>
      <View style={styles.middle}>
        <Text style={[type.display, styles.title]}>Novi</Text>
        <Text style={[type.title, styles.ink]}>Woezɔ</Text>
        <Text style={[type.body, styles.ink]}>Ewe letters: ɖ ƒ ɣ ŋ ɔ ɛ ʋ Ɖ Ƒ Ɣ Ŋ Ɔ Ɛ Ʋ</Text>
        <Text style={[type.small, styles.muted]}>Foundations check, replaced in the next steps.</Text>
      </View>
      <PrimaryButton label="Check the connection" onPress={() => router.push("/health")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  middle: { flex: 1, justifyContent: "center", gap: 12 },
  title: { color: colors.indigo },
  ink: { color: colors.ink },
  muted: { color: colors.muted },
});