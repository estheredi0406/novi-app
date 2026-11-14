// Novi's colours (D92), one meaning each (D121):
// - indigo: structure, titles, what is selected;
// - action blue: buttons and links;
// - orange: what waits for her now (Payer, an invitation, unread messages);
// - green: money paid or arrived;
// - saffron: whose turn it is to receive;
// - red: a money problem or a safety warning.
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
