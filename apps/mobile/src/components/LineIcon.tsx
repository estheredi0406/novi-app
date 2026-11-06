import Svg, { Circle, Path, Rect } from "react-native-svg";
import { colors } from "../theme/colors";

// Thin line icons for tiles, the bar and the card's buttons (D92): drawn on a
// 24 grid, one stroke weight, round ends, so they read as one family.
export type LineIconName =
  | "phone"
  | "chat"
  | "swap"
  | "hand"
  | "bank"
  | "plus"
  | "home"
  | "groups"
  | "clock"
  | "user"
  | "bell"
  | "speaker"
  | "stop"
  | "more"
  | "qr"
  | "calendar"
  | "chevron";

export function LineIcon({
  name,
  color = colors.lagoon,
  size = 24,
}: {
  name: LineIconName;
  color?: string;
  size?: number;
}) {
  const p = { stroke: color, strokeWidth: 1.8, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "phone" ? (
        <Path {...p} d="M6 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 4 5a2 2 0 0 1 2-2z" />
      ) : name === "chat" ? (
        <>
          <Path {...p} d="M4 5h16v11H9l-5 4z" />
          <Path {...p} d="M8 9h8M8 12h5" />
        </>
      ) : name === "swap" ? (
        <Path {...p} d="M4 8h13l-3-3M20 16H7l3 3" />
      ) : name === "hand" ? (
        <>
          <Circle {...p} cx={15} cy={7} r={3.2} />
          <Path {...p} d="M3 14h4l3 2h5a1.6 1.6 0 0 1 0 3H9M3 20h11l6-4.5a1.6 1.6 0 0 0-2-2.4L14 16" />
        </>
      ) : name === "bank" ? (
        <Path {...p} d="M3 9l9-5 9 5zM5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18" />
      ) : name === "plus" ? (
        <>
          <Rect {...p} x={3.5} y={3.5} width={17} height={17} rx={5} />
          <Path {...p} d="M12 8v8M8 12h8" />
        </>
      ) : name === "home" ? (
        <Path {...p} d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />
      ) : name === "groups" ? (
        <>
          <Circle {...p} cx={9} cy={9} r={3.2} />
          <Circle {...p} cx={16.5} cy={10} r={2.6} />
          <Path {...p} d="M3 19a6 6 0 0 1 12 0M14 15.5a5 5 0 0 1 7 3.5" />
        </>
      ) : name === "clock" ? (
        <>
          <Circle {...p} cx={12} cy={12} r={8.5} />
          <Path {...p} d="M12 7v5l3.5 2" />
        </>
      ) : name === "user" ? (
        <>
          <Circle {...p} cx={12} cy={8.5} r={3.8} />
          <Path {...p} d="M4.5 20a7.5 7.5 0 0 1 15 0" />
        </>
      ) : name === "bell" ? (
        <Path {...p} d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0" />
      ) : name === "speaker" ? (
        <>
          <Path {...p} d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
          <Path {...p} d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
        </>
      ) : name === "stop" ? (
        <Rect x={6.5} y={6.5} width={11} height={11} rx={2.5} fill={color} stroke="none" />
      ) : name === "more" ? (
        <>
          <Circle cx={5.5} cy={12} r={1.7} fill={color} />
          <Circle cx={12} cy={12} r={1.7} fill={color} />
          <Circle cx={18.5} cy={12} r={1.7} fill={color} />
        </>
      ) : name === "qr" ? (
        <>
          <Rect {...p} x={4} y={4} width={6} height={6} rx={1} />
          <Rect {...p} x={14} y={4} width={6} height={6} rx={1} />
          <Rect {...p} x={4} y={14} width={6} height={6} rx={1} />
          <Path {...p} d="M14 14h2v2M20 14v6h-4M14 18v2" />
        </>
      ) : name === "calendar" ? (
        <>
          <Rect {...p} x={3.5} y={5} width={17} height={15} rx={3} />
          <Path {...p} d="M3.5 10h17M8 3v4M16 3v4" />
        </>
      ) : (
        <Path {...p} d="M9 5l7 7-7 7" />
      )}
    </Svg>
  );
}
