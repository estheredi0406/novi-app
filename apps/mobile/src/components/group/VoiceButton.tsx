import {
  AudioQuality,
  IOSOutputFormat,
  type RecordingOptions,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { File } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, PanResponder, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { formatSeconds } from "../../lib/format";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";

// A voice note is a minute at most.
export const VOICE_MAX_MS = 60_000;
// Shorter than this is a slip of the finger, not a message.
const MIN_MS = 800;
// Sliding this far left cancels the note.
const CANCEL_DX = -90;

// Small enough for a weak connection and an old phone (about 240 KB for a
// full minute), clear enough for a voice: mono AAC in an .m4a file, the same
// on Android and iPhone, so every member's phone can play it.
const VOICE: RecordingOptions = {
  extension: ".m4a",
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 32000,
  android: { outputFormat: "mpeg4", audioEncoder: "aac" },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.LOW },
  web: { mimeType: "audio/webm", bitsPerSecond: 32000 },
};

// Hold to record, let go to send, slide left to cancel: the way voice notes
// work in the messaging apps the members already use (approved design V4).
// While she holds, the bar shows a red dot, the time, and how to cancel.
export function VoiceButton({
  disabled,
  onRecording,
  onSend,
}: {
  disabled: boolean;
  onRecording: (recording: boolean) => void;
  onSend: (note: { audioBase64: string; durationMs: number; mime: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const recorder = useAudioRecorder(VOICE);
  const state = useAudioRecorderState(recorder, 200);
  const [holding, setHolding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const started = useRef(0);
  const cancelled = useRef(false);
  const active = useRef(false);

  async function start() {
    if (disabled || active.current) return;
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t("voice.micTitle"), t("voice.micBody"));
      return;
    }
    active.current = true;
    cancelled.current = false;
    setCancelling(false);
    setHolding(true);
    onRecording(true);
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      started.current = Date.now();
    } catch {
      finish(false);
    }
  }

  async function stop() {
    if (!active.current) return;
    const durationMs = Math.min(Date.now() - started.current, VOICE_MAX_MS);
    try {
      await recorder.stop();
    } catch {
      // a recorder that never started has nothing to stop
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    const uri = recorder.uri;
    const keep = !cancelled.current && durationMs >= MIN_MS && uri;
    finish(false);
    if (!keep || !uri) return;
    const file = new File(uri);
    try {
      await onSend({ audioBase64: await file.base64(), durationMs, mime: "audio/mp4" });
    } finally {
      // The note is on the server now, or it failed: either way the local
      // copy is not kept.
      try {
        file.delete();
      } catch {
        // already gone
      }
    }
  }

  function finish(recording: boolean) {
    active.current = recording;
    setHolding(recording);
    setCancelling(false);
    onRecording(recording);
  }

  // At one minute, the note sends itself.
  useEffect(() => {
    if (holding && state.durationMillis >= VOICE_MAX_MS) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding, state.durationMillis]);

  // The responder is made once; it calls the latest start and stop.
  const latest = useRef({ start, stop });
  latest.current = { start, stop };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => void latest.current.start(),
      onPanResponderMove: (_e, g) => {
        const now = g.dx < CANCEL_DX;
        cancelled.current = now;
        setCancelling(now);
      },
      onPanResponderRelease: () => void latest.current.stop(),
      onPanResponderTerminate: () => {
        cancelled.current = true;
        void latest.current.stop();
      },
    }),
  ).current;

  return (
    <View style={[styles.row, holding && styles.rowHolding]}>
      {holding ? (
        <View style={styles.status}>
          <View style={styles.dot} />
          <Text style={styles.time}>{formatSeconds(Math.floor(state.durationMillis / 1000))}</Text>
          <Text style={[styles.hint, cancelling && styles.hintCancel]}>
            {cancelling ? t("voice.releaseToCancel") : `‹ ${t("voice.slideToCancel")}`}
          </Text>
        </View>
      ) : null}
      <View
        {...pan.panHandlers}
        accessible
        accessibilityRole="button"
        accessibilityLabel={t("voice.hold")}
        style={[styles.halo, holding && styles.haloOn, disabled && styles.off]}
      >
        <View style={[styles.mic, holding && styles.micOn]}>
          <Svg width={22} height={22} viewBox="0 0 24 24">
            <Rect x={9} y={3} width={6} height={11} rx={3} fill={colors.white} />
            <Path
              d="M5.5 11 C5.5 14.6 8.4 17.5 12 17.5 C15.6 17.5 18.5 14.6 18.5 11 M12 17.5 V21"
              stroke={colors.white}
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
            />
          </Svg>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  rowHolding: { flex: 1 },
  status: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.problem },
  time: { width: 46, fontFamily: fonts.bodyBold, fontSize: 17, color: colors.indigo },
  hint: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  hintCancel: { fontFamily: fonts.bodyBold, color: colors.problem },
  halo: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  haloOn: { width: 72, height: 72, borderRadius: 36, margin: -10, backgroundColor: "rgba(240,90,26,0.22)" },
  mic: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    alignItems: "center",
    justifyContent: "center",
  },
  micOn: { width: 56, height: 56, borderRadius: 28 },
  off: { opacity: 0.4 },
});
