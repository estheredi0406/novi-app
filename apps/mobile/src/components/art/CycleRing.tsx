import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Ellipse, Path } from "react-native-svg";
import { colors } from "../../theme/colors";

// Her cycle on home (D122): one arc per round, starting at
// the top. Rounds before this one are green (paid), this round is orange while
// she owes, blue while her payment is being confirmed, green once paid, and
// the rounds to come are pale. A saffron cowrie sits on the round where she
// receives her pot. Whatever is passed as children sits in the middle.
export type RoundState = "owe" | "pending" | "paid";

export function CycleRing({
  rounds,
  current,
  state,
  potRound,
  size = 132,
  children,
}: {
  rounds: number;
  current: number; // this round, from 1
  state: RoundState;
  potRound: number | null; // the round whose pot is hers, from 1
  size?: number;
  children?: ReactNode;
}) {
  const n = Math.max(rounds, 1);
  const stroke = 12;
  const c = size / 2;
  const r = c - stroke / 2 - 8;
  const gap = n <= 12 ? 12 : 5; // degrees between arcs
  const at = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: c + r * Math.cos(a), y: c + r * Math.sin(a) };
  };

  const arcs = Array.from({ length: n }, (_, i) => {
    const a0 = -90 + (i * 360) / n + gap / 2;
    const a1 = -90 + ((i + 1) * 360) / n - gap / 2;
    const p0 = at(a0);
    const p1 = at(a1);
    const large = a1 - a0 > 180 ? 1 : 0;
    const round = i + 1;
    const color =
      round < current
        ? colors.paid
        : round > current
          ? colors.seatEmpty
          : state === "owe"
            ? colors.accent
            : state === "pending"
              ? colors.action
              : colors.paid;
    return { d: `M${p0.x} ${p0.y} A${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`, color, mid: at((a0 + a1) / 2), round };
  });
  const pot = potRound ? arcs[potRound - 1] : undefined;
  const k = size / 14; // the cowrie's half height

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {arcs.map((a) => (
          <Path key={a.round} d={a.d} stroke={a.color} strokeWidth={stroke} strokeLinecap="round" fill="none" />
        ))}
        {pot ? (
          <>
            <Circle cx={pot.mid.x} cy={pot.mid.y} r={k + 3} fill={colors.white} />
            <Ellipse cx={pot.mid.x} cy={pot.mid.y} rx={k * 0.62} ry={k} fill={colors.yourTurn} />
            <Path
              d={`M${pot.mid.x} ${pot.mid.y - k + 3}V${pot.mid.y + k - 3}`}
              stroke={colors.white}
              strokeWidth={1.4}
            />
          </>
        ) : null}
      </Svg>
      <View style={styles.middle}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  middle: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
});
