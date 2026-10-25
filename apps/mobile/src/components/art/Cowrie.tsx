import { G, Path } from "react-native-svg";
import { colors } from "../../theme/colors";

// A cowrie shell: for centuries the money of West Africa, so it is Novi's
// motif for savings (25 Oct, replacing the decorative leaves). Drawn upright
// around (cx, cy), then turned by `rotate` degrees: an oval shell, a toothed
// slit down the middle, a fine navy outline.
export function Cowrie({
  cx,
  cy,
  rx,
  ry,
  rotate = 0,
  fill = colors.accent,
  strokeWidth = 1.6,
}: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotate?: number;
  fill?: string;
  strokeWidth?: number;
}) {
  // An egg-shaped shell, fuller at the top, with a dark toothed slit and a
  // soft highlight on one side.
  const shell = `M${cx} ${cy - ry} C${cx + rx * 1.25} ${cy - ry} ${cx + rx * 1.05} ${cy + ry} ${cx} ${cy + ry} C${cx - rx * 1.05} ${cy + ry} ${cx - rx * 1.25} ${cy - ry} ${cx} ${cy - ry} Z`;
  const b = rx * 0.12;
  const slit = `M${cx} ${cy - ry * 0.8} C${cx + b} ${cy - ry * 0.3} ${cx + b} ${cy + ry * 0.3} ${cx} ${cy + ry * 0.82} C${cx - b} ${cy + ry * 0.3} ${cx - b} ${cy - ry * 0.3} ${cx} ${cy - ry * 0.8} Z`;
  const teeth = [-0.55, -0.4, -0.25, -0.1, 0.05, 0.2, 0.35, 0.5, 0.65]
    .map((k) => `M${cx - b * 2.2} ${cy + ry * k} H${cx + b * 2.2}`)
    .join(" ");
  const highlight = `M${cx - rx * 0.55} ${cy - ry * 0.55} C${cx - rx * 0.75} ${cy - ry * 0.1} ${cx - rx * 0.7} ${cy + ry * 0.3} ${cx - rx * 0.5} ${cy + ry * 0.6}`;

  return (
    <G rotation={rotate} origin={`${cx}, ${cy}`}>
      <Path d={shell} fill={fill} stroke={colors.indigo} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path
        d={highlight}
        stroke={colors.shell}
        strokeWidth={strokeWidth * 1.4}
        fill="none"
        strokeLinecap="round"
        opacity={0.7}
      />
      <Path d={teeth} stroke={colors.indigo} strokeWidth={strokeWidth * 0.8} strokeLinecap="round" />
      <Path d={slit} fill={colors.indigo} />
    </G>
  );
}
