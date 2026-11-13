// Novi's palette, direction "Lagune" (D92): the deep blues of a bank
// app people already trust, with Novi's own pagne motif and cowries on top.
// One meaning per colour, on every screen (D121):
// - indigo: structure (bands, titles, what is selected, "you" in a group);
// - action blue: every button and link;
// - orange (accent): only what waits for her now: Payer and the pay buttons,
//   an invitation to answer, unread messages, a meeting that is live;
// - green (paid): money paid or arrived, a condition met;
// - saffron (yourTurn): whose turn it is to receive, or something waiting
//   on someone else;
// - red (problem): a problem with money, or a safety warning about it.
export const colors = {
  indigo: "#06294A", // night blue: headings, outlines, dark screens
  action: "#0B4F8A", // links
  accent: "#F05A1A", // orange: only what waits for her now (D121)
  accentSoft: "#FFF4EC",
  actionPressed: "#083D6B",
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
  turnSoft: "#FDF1DC", // saffron backgrounds
  turnText: "#8A5A00", // saffron text, readable on white
  paid: "#1E8A5A",
  paidSoft: "#E3F3EA",
  problem: "#C2362B",
  problemSoft: "#FDE8E6",
} as const;
