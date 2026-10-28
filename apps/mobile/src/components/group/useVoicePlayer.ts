import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";
import { errorKey } from "../../api/client";
import { getVoice } from "../../api/groups";

// One player for the whole chat, so only one voice note plays at a time.
// A note is fetched once and kept in the phone's cache, so listening again
// costs no data.
export function useVoicePlayer(groupId: string, onError: (key: string) => void) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // At the end of a note, back to the start, ready to play again.
  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      void player.seekTo(0);
      setPlayingId(null);
    }
  }, [status.didJustFinish, player]);

  async function toggle(messageId: string) {
    if (playingId === messageId) {
      if (status.playing) player.pause();
      else player.play();
      return;
    }
    setLoadingId(messageId);
    try {
      const file = new File(Paths.cache, `novi-voice-${messageId}.m4a`);
      if (!file.exists) {
        const { audioBase64 } = await getVoice(groupId, messageId);
        file.create({ overwrite: true });
        await file.write(audioBase64, { encoding: "base64" });
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      player.replace({ uri: file.uri });
      player.play();
      setPlayingId(messageId);
    } catch (err) {
      onError(errorKey(err));
    } finally {
      setLoadingId(null);
    }
  }

  function stop() {
    player.pause();
    setPlayingId(null);
  }

  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  return { toggle, stop, playingId, loadingId, playing: status.playing, progress, currentTime: status.currentTime };
}
