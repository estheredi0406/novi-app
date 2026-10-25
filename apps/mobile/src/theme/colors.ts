// Novi's palette, from the wax-print direction (25 Oct): navy outlines,
// lavender crackle, orange and teal leaves on cotton. Three colours carry
// meaning and are never used for anything else: paid green only means a
// payment went through, problem red only means a problem with money, and
// saffron only marks "your turn".
export const colors = {
  indigo: "#1B1F4B", // navy: headings, outlines, dark screens
  action: "#1B1F4B", // links
  accent: "#F05A1A", // wax orange: main buttons, the active tab
  teal: "#1FA3A0", // wax teal: decoration only
  mist: "#DCD8EE", // lavender: soft backgrounds, header bands
  crackle: "#A9A6D6", // the crackle lines on lavender
  shell: "#FBF7F2", // screen background: cotton
  card: "#FFFFFF", // cards on the cotton
  ink: "#141833", // body text
  muted: "#3A3D6B", // secondary text
  line: "#E6E1F2", // soft dividers and field borders
  onDark: "#F3F4FC", // text on navy
  white: "#FFFFFF",
  laterite: "#B5532E", // the red earth of Lome's streets: only in patterns, never for meaning
  gold: "#F5CE6B", // coins in the pot
  goldDeep: "#E9B44C",

  yourTurn: "#F2A93B", // saffron
  paid: "#1E7A4C",
  problem: "#C2362B",
} as const;
