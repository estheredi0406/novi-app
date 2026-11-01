// Novi's palette, direction "Lagune" (1 Nov, D92): the deep blues of a bank
// app people already trust, with Novi's own pagne motif and cowries on top.
// The key names stay from the wax-print palette (25 Oct) so every screen
// follows without being rewritten. Three colours carry meaning and are never
// used for anything else: paid green only means a payment went through,
// problem red only means a problem with money, and saffron only marks
// "your turn" (or whose turn it is).
export const colors = {
  indigo: "#06294A", // night blue: headings, outlines, dark screens
  action: "#0B4F8A", // links
  accent: "#F05A1A", // orange: Payer and the main buttons only
  lagoon: "#0B4F8A", // the header band
  teal: "#14A7C9", // turquoise: decoration only
  mist: "#E3F2F8", // sky: soft backgrounds, tiles, quiet buttons
  crackle: "#A9C6DA", // fine lines on sky
  shell: "#F3F6F9", // screen background
  card: "#FFFFFF", // cards on the background
  ink: "#0A2238", // body text
  muted: "#4A6278", // secondary text
  line: "#D6E1EA", // soft dividers and field borders
  onDark: "#F3F7FB", // text on the blue band
  white: "#FFFFFF",
  laterite: "#B5532E", // the red earth of Lomé's streets: only in patterns, never for meaning
  gold: "#F5CE6B", // coins in the pot
  goldDeep: "#E9B44C",
  seatEmpty: "#DCE6EE", // a seat in the ring that has not paid yet

  yourTurn: "#F2A93B", // saffron
  paid: "#1E8A5A",
  problem: "#C2362B",
} as const;
