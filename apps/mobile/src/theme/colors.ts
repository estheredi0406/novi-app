// Novi's palette. Two colours carry meaning and are never used for anything
// else: paid green only means a payment went through, and problem red only
// means a problem with money. Saffron only marks "your turn".
export const colors = {
  indigo: "#22306B", // headings, dark screens
  action: "#2E42A6", // buttons and links
  mist: "#DDE2F5", // soft backgrounds, focus rings
  shell: "#F8F8FC", // screen background
  ink: "#141833", // body text
  muted: "#4B5070", // secondary text
  line: "#DADFEF", // borders
  onDark: "#F3F4FC", // text on indigo
  white: "#FFFFFF",

  yourTurn: "#F2A93B", // saffron
  paid: "#1E7A4C",
  problem: "#C2362B",
} as const;