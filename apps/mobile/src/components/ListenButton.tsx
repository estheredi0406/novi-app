import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, type StyleProp, StyleSheet, Text, type ViewStyle } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { onSpeakingChange, speak, speakingOwner, stopSpeaking } from "../lib/speak";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { LineIcon } from "./LineIcon";

// Reads the screen aloud. French and English use the phone's voice; Ewe plays
// the recorded sentences (lib/speak). Tap again to stop (D99).
function useListen(text: string) {
  const id = useId();
  const [owner, setOwner] = useState(speakingOwner());
  useEffect(() => onSpeakingChange(setOwner), []);
  const speaking = owner === id;
  const toggle = () => (speaking ? stopSpeaking() : speak(text, id));
  return { speaking, toggle };
}

// The cotton pill used on sign-up, back headers and sheets.
export function ListenButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const { speaking, toggle } = useListen(text);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: speaking }}
      onPress={toggle}
      style={styles.button}
    >
      <Svg width={18} height={18} viewBox="0 0 24 24">
        {speaking ? (
          <Rect x={6} y={6} width={12} height={12} rx={2.5} fill={colors.lagoon} />
        ) : (
          <Path
            d="M5 9v6h4l5 4V5L9 9H5z M17 9a4 4 0 0 1 0 6"
            stroke={colors.lagoon}
            strokeWidth={2.4}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </Svg>
      <Text style={styles.label}>{t(speaking ? "common.stop" : "common.listen")}</Text>
    </Pressable>
  );
}

// The round white icon on the blue bands (home, a group, a payment).
export function ListenRound({ text, style }: { text: string; style: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const { speaking, toggle } = useListen(text);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(speaking ? "common.stop" : "hub.listen")}
      accessibilityState={{ busy: speaking }}
      onPress={toggle}
      style={style}
      hitSlop={6}
    >
      <LineIcon name={speaking ? "stop" : "speaker"} color={colors.white} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: colors.mist,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  label: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.lagoon },
});
