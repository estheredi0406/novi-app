import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { NoviMark } from "./art/NoviMark";
import { HeaderBand } from "./HeaderBand";
import { StepHeader } from "./StepHeader";

// The top of every sign-up, login and PIN screen, in the wax look of the
// rest of the app: the lavender band with its crackle and cowries, holding
// back, the progress and Listen, then the step, the title and one line.
export function AuthBand({
  step,
  eyebrow,
  title,
  lede,
  listenText,
  mark = false,
  children,
}: {
  step?: number;
  eyebrow?: string;
  title: string;
  lede?: string;
  listenText: string;
  mark?: boolean; // Novi's cowries, on the first screens she sees
  children?: ReactNode;
}) {
  return (
    <HeaderBand>
      <StepHeader step={step} listenText={listenText} />
      <View style={styles.text}>
        {mark ? <NoviMark size={76} /> : null}
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>
        {lede ? <Text style={styles.lede}>{lede}</Text> : null}
        {children}
      </View>
    </HeaderBand>
  );
}

const styles = StyleSheet.create({
  text: { gap: 6, paddingTop: 8, paddingRight: 48 },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.accent,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  title: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, color: colors.indigo },
  lede: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.muted },
});
