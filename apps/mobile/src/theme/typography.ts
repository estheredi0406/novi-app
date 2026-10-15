import type { TextStyle } from "react-native";

// Noto Sans and Noto Sans Display both contain the Ewe letters ɖ ƒ ɣ ŋ ɔ ɛ ʋ.
// Names match the fonts loaded in src/app/_layout.tsx.
export const fonts = {
  body: "NotoSans_400Regular",
  bodySemiBold: "NotoSans_600SemiBold",
  bodyBold: "NotoSans_700Bold",
  display: "NotoSansDisplay_800ExtraBold",
} as const;

// Body text is 17 points, above the common 14 to 16, so it stays readable
// for older eyes and in bright market sunlight.
export const type = {
  display: { fontFamily: fonts.display, fontSize: 40, lineHeight: 44 },
  title: { fontFamily: fonts.bodyBold, fontSize: 24, lineHeight: 30 },
  body: { fontFamily: fonts.body, fontSize: 17, lineHeight: 24 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 20 },
  small: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
} satisfies Record<string, TextStyle>;