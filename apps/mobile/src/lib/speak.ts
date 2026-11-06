import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from "expo-audio";
import * as Speech from "expo-speech";
import i18n from "../i18n";
import { clips } from "../voice/ee/clips";

// Reads a text aloud (Listen, a chat line). In French and English, the
// phone's own voice. In Ewe, phones have no voice of their own: each
// sentence that a person listened to and kept in the voice studio plays
// from its recording; anything else (a group's name, a sentence not kept
// yet) falls back to the phone's French voice.

type Piece = number | string; // a recording, or text for the phone's voice

const norm = (s: string) =>
  s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[.!?…:;,\s]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

let byText: Map<string, number> | null = null;
function recordings(): Map<string, number> {
  byText ??= new Map(Object.values(clips).map((c) => [norm(c.text), c.file]));
  return byText;
}

// Sentences as the screens join them: "Name. Sentence. Sentence."
function pieces(text: string): Piece[] {
  const whole = recordings().get(norm(text));
  if (whole !== undefined) return [whole];
  return text
    .split(/(?<=[.!?])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => recordings().get(norm(part)) ?? part);
}

let run = 0;
let player: AudioPlayer | null = null;

// Which Listen button is speaking right now (null: silence), so that button
// can show "Arrêter" and stop the reading when tapped again (D99). Screens
// subscribe with onSpeakingChange; every way the sound ends sets it back.
let owner: string | null = null;
const listeners = new Set<(owner: string | null) => void>();

function setOwner(next: string | null): void {
  if (owner === next) return;
  owner = next;
  for (const listener of listeners) listener(owner);
}

export function speakingOwner(): string | null {
  return owner;
}

export function onSpeakingChange(listener: (owner: string | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// A reading that ended by itself clears the owner, unless a newer reading
// has started since (run moved on).
function finished(mine: number): void {
  if (mine === run) setOwner(null);
}

export function stopSpeaking(): void {
  run++;
  void Speech.stop();
  player?.remove();
  player = null;
  setOwner(null);
}

// `by` names the button that asked, so only that button shows "Arrêter".
export function speak(text: string, by: string = text): void {
  stopSpeaking();
  const mine = run;
  setOwner(by);
  const lang = i18n.language;
  if (lang !== "ee" || Object.keys(clips).length === 0) {
    Speech.speak(text, {
      language: lang === "en" ? "en-US" : "fr-FR",
      rate: 0.9,
      onDone: () => finished(mine),
      onStopped: () => finished(mine),
      onError: () => finished(mine),
    });
    return;
  }
  void playAll(pieces(text), mine).finally(() => finished(mine));
}

async function playAll(list: Piece[], mine: number) {
  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => undefined);
  for (const piece of list) {
    if (mine !== run) return;
    if (typeof piece === "number") await playClip(piece, mine);
    else await sayText(piece, mine);
  }
}

function sayText(text: string, mine: number): Promise<void> {
  return new Promise((resolve) => {
    if (mine !== run) return resolve();
    Speech.speak(text, { language: "fr-FR", rate: 0.9, onDone: resolve, onStopped: resolve, onError: () => resolve() });
  });
}

function playClip(file: number, mine: number): Promise<void> {
  return new Promise((resolve) => {
    if (mine !== run) return resolve();
    const clip = createAudioPlayer(file);
    player = clip;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      try {
        sub.remove();
        if (player === clip) {
          clip.remove();
          player = null;
        }
      } catch {
        // already released by stopSpeaking
      }
      resolve();
    };
    const sub = clip.addListener("playbackStatusUpdate", (status) => {
      if (status.didJustFinish || mine !== run) done();
    });
    // A clip never holds the queue for long, even if its end is missed.
    const guard = setTimeout(done, 20_000);
    clip.play();
  });
}
