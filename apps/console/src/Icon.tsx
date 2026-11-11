// Thin line icons for the console's sidebar and lists (D92): the same family
// as the member app's, drawn on a 24 grid with one stroke weight.
const PATHS = {
  home: "M4 11l8-7 8 7v9h-5v-6H9v6H4z",
  groups: "M9 5.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4M16.5 7.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2M3 19a6 6 0 0 1 12 0M14 15.5a5 5 0 0 1 7 3.5",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  bank: "M3 9l9-5 9 5zM5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18",
  doc: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5",
  user: "M12 4.7a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6M4.5 20a7.5 7.5 0 0 1 15 0",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  team: "M12 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6M6 20a6 6 0 0 1 12 0M3 11h3M18 11h3",
  coin: "M5 7c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5",
  hand: "M15 3.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4M3 14h4l3 2h5a1.6 1.6 0 0 1 0 3H9M3 20h11l6-4.5a1.6 1.6 0 0 0-2-2.4L14 16",
  alert: "M12 4l9 16H3zM12 10v4M12 17h.01",
  check: "M5 12.5l4.5 4.5L19 7",
  search: "M11 4.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13M16 16l4.5 4.5",
  chevron: "M9 5l7 7-7 7",
  // D116: Réglages, a slider panel.
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

// The ring of a group's seats (D92), as in the member app, but anonymous:
// the console shows how many paid this round, never who (D33).
export function Ring({ paid, size: n, px = 48, stroke = 6 }: { paid: number; size: number; px?: number; stroke?: number }) {
  const r = px / 2 - stroke / 2 - 2;
  const c = px / 2;
  const gap = n <= 12 ? 6 : 3;
  const at = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(c + r * Math.cos(a)).toFixed(1)} ${(c + r * Math.sin(a)).toFixed(1)}`;
  };
  return (
    <svg width={px} height={px} aria-hidden="true">
      {Array.from({ length: Math.max(n, 1) }, (_, i) => {
        const a0 = -90 + (i * 360) / n + gap / 2;
        const a1 = -90 + ((i + 1) * 360) / n - gap / 2;
        return (
          <path
            key={i}
            d={`M${at(a0)} A${r} ${r} 0 0 1 ${at(a1)}`}
            stroke={i < paid ? "var(--paid)" : "var(--seat)"}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
          />
        );
      })}
    </svg>
  );
}
