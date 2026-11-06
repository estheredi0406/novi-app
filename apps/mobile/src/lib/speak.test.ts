import { beforeEach, describe, expect, it, vi } from "vitest";

// The phone's voice and audio are replaced by fakes: the test only checks who
// is speaking, and that every way a reading ends gives the silence back (D99).
const spoken: { text: string; onDone?: () => void }[] = [];
vi.mock("expo-speech", () => ({
  speak: (text: string, options: { onDone?: () => void }) => spoken.push({ text, onDone: options.onDone }),
  stop: vi.fn(async () => undefined),
}));
vi.mock("expo-audio", () => ({ createAudioPlayer: vi.fn(), setAudioModeAsync: vi.fn(async () => undefined) }));
vi.mock("../i18n", () => ({ default: { language: "fr" } }));
vi.mock("../voice/ee/clips", () => ({ clips: {} }));

const { speak, speakingOwner, stopSpeaking, onSpeakingChange } = await import("./speak");

describe("Listen: who is speaking, and how it stops", () => {
  beforeEach(() => {
    stopSpeaking();
    spoken.length = 0;
  });

  it("marks the button that asked as speaking", () => {
    speak("Vous êtes sur l'accueil.", "home");
    expect(speakingOwner()).toBe("home");
    expect(spoken[0]?.text).toBe("Vous êtes sur l'accueil.");
  });

  it("gives the silence back when she taps again (stop)", () => {
    speak("Texte", "home");
    stopSpeaking();
    expect(speakingOwner()).toBeNull();
  });

  it("gives the silence back when the reading ends by itself", () => {
    speak("Texte", "home");
    spoken[0]?.onDone?.();
    expect(speakingOwner()).toBeNull();
  });

  it("hands over to a new reading, and the old one ending later changes nothing", () => {
    speak("Accueil", "home");
    speak("Paiement", "payment");
    spoken[0]?.onDone?.(); // the first reading's end arrives late
    expect(speakingOwner()).toBe("payment");
  });

  it("tells the screens each change, and stops telling them once they leave", () => {
    const seen: (string | null)[] = [];
    const leave = onSpeakingChange((owner) => seen.push(owner));
    speak("Texte", "group");
    stopSpeaking();
    leave();
    speak("Encore", "group");
    expect(seen).toEqual(["group", null]);
  });
});
