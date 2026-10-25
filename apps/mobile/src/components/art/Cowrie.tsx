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
  // An egg-shaped shell with a dark slit down the middle; the fine teeth
  // sit inside the slit, in the shell's colour, and a soft gold line marks
  // the rounded back.
  const shell = `M${cx} ${cy - ry} C${cx + rx * 1.32} ${cy - ry} ${cx + rx * 1.2} ${cy + ry} ${cx} ${cy + ry} C${cx - rx * 1.2} ${cy + ry} ${cx - rx * 1.32} ${cy - ry} ${cx} ${cy - ry} Z`;
  const b = rx * 0.2;
  const slit = `M${cx} ${cy - ry * 0.8} C${cx + b} ${cy - ry * 0.35} ${cx + b} ${cy + ry * 0.35} ${cx} ${cy + ry * 0.82} C${cx - b} ${cy + ry * 0.35} ${cx - b} ${cy - ry * 0.35} ${cx} ${cy - ry * 0.8} Z`;
  const teeth = [-0.5, -0.36, -0.22, -0.08, 0.06, 0.2, 0.34, 0.48]
    .map((k) => {
      const half = b * 0.85 * (1 - k * k * 1.6);
      return `M${cx - half} ${cy + ry * k} H${cx - b * 0.15} M${cx + b * 0.15} ${cy + ry * (k + 0.05)} H${cx + half}`;
    })
    .join(" ");
  const back = `M${cx - rx * 0.62} ${cy - ry * 0.5} C${cx - rx * 0.85} ${cy} ${cx - rx * 0.75} ${cy + ry * 0.4} ${cx - rx * 0.5} ${cy + ry * 0.7}`;

  return (
    <G rotation={rotate} origin={`${cx}, ${cy}`}>
      <Path d={shell} fill={fill} stroke={colors.indigo} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path
        d={back}
        stroke={colors.goldDeep}
        strokeWidth={strokeWidth * 1.6}
        fill="none"
        strokeLinecap="round"
        opacity={0.55}
      />
      <Path d={slit} fill={colors.indigo} />
      <Path d={teeth} stroke={fill} strokeWidth={strokeWidth * 0.8} strokeLinecap="round" />
    </G>
  );
}
