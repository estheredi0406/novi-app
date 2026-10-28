import type { ChatMessage, GroupMeetingView } from "@novi/shared";
import { type Href, router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { errorKey } from "../../api/client";
import { callGroup, hideMessage, joinMeeting, listMessages, postMessage, postVoice } from "../../api/groups";
import { formatSeconds } from "../../lib/format";
import { meetingWhen } from "../../lib/meetingTime";
import { speak, stopSpeaking } from "../../lib/speak";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";
import { Cowrie } from "../art/Cowrie";
import { ErrorMessage } from "../ErrorMessage";
import { useVoicePlayer } from "./useVoicePlayer";
import { VoiceButton } from "./VoiceButton";

// The "Discussion" tab (D70, approved design F2): the next meeting and the
// calendar one tap away, "Appeler le groupe", then the chat itself, with
// voice notes for members who would rather speak than type (D76). New lines
// are fetched every few seconds while the tab is open.
const EVERY_MS = 5000;
const MAX_LENGTH = 500;

export function GroupChat({ groupId, nextMeeting }: { groupId: string; nextMeeting: GroupMeetingView | null }) {
  const { t, i18n } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [canWrite, setCanWrite] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<FlatList<ChatMessage>>(null);
  const latest = useRef<string | null>(null);
  const voice = useVoicePlayer(groupId, setError);

  // Adds lines she does not have yet, keeping the order and no duplicates.
  const merge = useCallback((incoming: ChatMessage[], atStart = false) => {
    setMessages((current) => {
      const known = new Map(current.map((m) => [m.id, m]));
      for (const m of incoming) known.set(m.id, m);
      const fresh = incoming.filter((m) => !current.some((c) => c.id === m.id));
      const merged = atStart ? [...fresh, ...current] : [...current, ...fresh];
      const result = merged.map((m) => known.get(m.id) as ChatMessage);
      latest.current = result.at(-1)?.id ?? latest.current;
      return result;
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function poll() {
        try {
          const first = latest.current === null;
          const page = await listMessages(groupId, first ? {} : { after: latest.current as string });
          if (!active) return;
          if (first) setHasEarlier(page.hasEarlier);
          setCanWrite(page.canWrite);
          merge(page.messages);
          setError(null);
        } catch (err) {
          if (active) setError(errorKey(err));
        } finally {
          if (active) setLoaded(true);
        }
      }
      void poll();
      const timer = setInterval(() => void poll(), EVERY_MS);
      return () => {
        active = false;
        clearInterval(timer);
        stopSpeaking();
        voice.stop();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupId, merge]),
  );

  const toEnd = () => setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);

  async function earlier() {
    const first = messages[0];
    if (!first) return;
    try {
      const page = await listMessages(groupId, { before: first.id });
      setHasEarlier(page.hasEarlier);
      merge(page.messages, true);
    } catch (err) {
      setError(errorKey(err));
    }
  }

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      merge([await postMessage(groupId, body)]);
      setDraft("");
      toEnd();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setSending(false);
    }
  }

  async function sendVoice(note: { audioBase64: string; durationMs: number; mime: string }) {
    setSending(true);
    setError(null);
    try {
      merge([await postVoice(groupId, note)]);
      toEnd();
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setSending(false);
    }
  }

  // Joins the call already open, or starts one now (D76). The call opens in
  // the phone's browser, microphone on and camera off.
  async function call() {
    setCalling(true);
    setError(null);
    try {
      const { url } = await callGroup(groupId);
      await Linking.openURL(url);
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setCalling(false);
    }
  }

  async function join(meetingId: string) {
    setError(null);
    try {
      const { url } = await joinMeeting(groupId, meetingId);
      await Linking.openURL(url);
    } catch (err) {
      setError(errorKey(err));
    }
  }

  function hide(message: ChatMessage) {
    Alert.alert(t("chat.hideTitle"), t(message.mine ? "chat.hideMine" : "chat.hideOther"), [
      { text: t("chat.keep"), style: "cancel" },
      {
        text: t("chat.hide"),
        style: "destructive",
        onPress: () =>
          void hideMessage(groupId, message.id).then(
            (hidden) => merge([hidden]),
            (err: unknown) => setError(errorKey(err)),
          ),
      },
    ]);
  }

  function eventText(m: ChatMessage): string {
    const who = m.authorName ?? "";
    if (m.event === "CALL_STARTED") return t("chat.callStarted", { name: who });
    if (m.event === "MEETING_SCHEDULED" || m.event === "MEETING_CANCELLED") {
      const when = m.meeting ? meetingWhen(m.meeting.startsAt, i18n.language) : "";
      return t(m.event === "MEETING_SCHEDULED" ? "chat.meetingScheduled" : "chat.meetingCancelled", {
        name: who,
        title: m.meeting?.title ?? "",
        when,
      });
    }
    return m.event === "POT_PAID"
      ? t("chat.potPaid", { round: m.round, name: who })
      : t("chat.paid", { round: m.round, name: who });
  }

  const say = (text: string) => speak(text);

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(i18n.language === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit" });

  function renderEvent(item: ChatMessage) {
    const text = eventText(item);
    const call = item.event === "CALL_STARTED";
    const open = item.meeting?.state === "OPEN";
    return (
      <Pressable
        onPress={() => (item.meeting && !call ? router.push(`/groups/${groupId}/meetings` as Href) : say(text))}
        onLongPress={() => say(text)}
        style={styles.event}
        accessibilityRole="button"
        accessibilityLabel={text}
      >
        <Svg width={16} height={20} viewBox="0 0 40 52">
          <Cowrie
            cx={20}
            cy={26}
            rx={16}
            ry={22}
            fill={item.event === "POT_PAID" ? colors.gold : item.meeting ? colors.accent : colors.teal}
          />
        </Svg>
        <Text style={styles.eventText}>{text}</Text>
        {call ? (
          open ? (
            <Pressable accessibilityRole="button" onPress={() => void join(item.meeting?.id ?? "")} hitSlop={8}>
              <Text style={styles.joinText}>{t("chat.join")}</Text>
            </Pressable>
          ) : (
            <Text style={styles.eventTime}>{t("chat.callEnded")}</Text>
          )
        ) : (
          <Text style={styles.eventTime}>{time(item.createdAt)}</Text>
        )}
      </Pressable>
    );
  }

  function renderVoice(item: ChatMessage) {
    const mine = item.mine;
    const available = item.voice?.available ?? false;
    const isThis = voice.playingId === item.id;
    const playing = isThis && voice.playing;
    const total = Math.round((item.voice?.durationMs ?? 0) / 1000);
    const shown = isThis ? Math.floor(voice.currentTime) : total;
    const done = isThis ? voice.progress : 0;
    const label = `${mine ? t("chat.you") : item.authorName}. ${t("voice.note", { time: formatSeconds(total) })}`;
    return (
      <View style={[styles.line, mine && styles.lineMine]}>
        <Pressable
          onLongPress={item.canHide ? () => hide(item) : undefined}
          onPress={available ? () => void voice.toggle(item.id) : undefined}
          accessibilityRole="button"
          accessibilityLabel={available ? label : t("chat.voiceExpired")}
          style={[styles.bubble, styles.voiceBubble, mine ? styles.bubbleMine : styles.bubbleOther]}
        >
          {!mine ? <Text style={styles.author}>{item.authorName}</Text> : null}
          {available ? (
            <View style={styles.voiceRow}>
              <View style={[styles.play, mine && styles.playMine]}>
                {voice.loadingId === item.id ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Svg width={14} height={14} viewBox="0 0 24 24">
                    {playing ? (
                      <>
                        <Rect x={5} y={4} width={5} height={16} rx={1} fill={colors.white} />
                        <Rect x={14} y={4} width={5} height={16} rx={1} fill={colors.white} />
                      </>
                    ) : (
                      <Path d="M7 4 L20 12 L7 20 Z" fill={colors.white} />
                    )}
                  </Svg>
                )}
              </View>
              <Wave done={done} mine={mine} />
            </View>
          ) : (
            <Text style={[styles.body, styles.hiddenText, mine && styles.bodyMine]}>
              {item.hidden ? t("chat.hidden") : t("chat.voiceExpired")}
            </Text>
          )}
          <View style={styles.meta}>
            {available ? <Text style={[styles.time, mine && styles.timeMine]}>{formatSeconds(shown)}</Text> : null}
            <Text style={[styles.time, mine && styles.timeMine]}>{time(item.createdAt)}</Text>
          </View>
        </Pressable>
      </View>
    );
  }

  function renderItem({ item }: { item: ChatMessage }) {
    if (item.kind === "EVENT") return renderEvent(item);
    if (item.kind === "VOICE") return renderVoice(item);
    const spoken = item.hidden ? t("chat.hidden") : `${item.mine ? t("chat.you") : item.authorName}. ${item.body}`;
    return (
      <View style={[styles.line, item.mine && styles.lineMine]}>
        <Pressable
          onLongPress={item.canHide ? () => hide(item) : undefined}
          onPress={() => say(spoken)}
          accessibilityRole="button"
          accessibilityLabel={spoken}
          accessibilityHint={item.canHide ? t("chat.holdToHide") : undefined}
          style={[styles.bubble, item.mine ? styles.bubbleMine : styles.bubbleOther, item.hidden && styles.bubbleHidden]}
        >
          {!item.mine ? <Text style={styles.author}>{item.authorName}</Text> : null}
          <Text style={[styles.body, item.mine && styles.bodyMine, item.hidden && styles.hiddenText]}>
            {item.hidden ? t("chat.hidden") : item.body}
          </Text>
          <View style={styles.meta}>
            <Text style={[styles.time, item.mine && styles.timeMine]}>{time(item.createdAt)}</Text>
          </View>
        </Pressable>
      </View>
    );
  }

  const startsAt = nextMeeting ? new Date(nextMeeting.startsAt) : null;
  const locale = i18n.language === "en" ? "en-GB" : "fr-FR";
  const typing = draft.trim().length > 0;

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(`/groups/${groupId}/meetings` as Href)}
        style={styles.strip}
      >
        {startsAt && nextMeeting ? (
          <>
            <View style={styles.cal}>
              <Text style={styles.calTop}>{startsAt.toLocaleDateString(locale, { weekday: "short" }).toUpperCase()}</Text>
              <Text style={styles.calDay}>{startsAt.getDate()}</Text>
            </View>
            <View style={styles.stripText}>
              <Text style={styles.stripTitle}>
                {nextMeeting.state === "OPEN" ? t("meetings.openNow") : t("chat.meetingAt", {
                  time: startsAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
                })}
              </Text>
              <Text style={styles.stripSub} numberOfLines={1}>
                {nextMeeting.title}
              </Text>
            </View>
          </>
        ) : (
          <Text style={[styles.stripSub, styles.stripText]}>{t("meetings.none")}</Text>
        )}
        <Text style={styles.stripLink}>{t("chat.meetingsLink")} ›</Text>
      </Pressable>

      {canWrite ? (
        <View style={styles.callBar}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void call()}
            disabled={calling}
            style={[styles.call, calling && styles.off]}
          >
            {calling ? (
              <ActivityIndicator color={colors.indigo} size="small" />
            ) : (
              <Svg width={18} height={18} viewBox="0 0 24 24">
                <Path
                  d="M6 3 L9.5 3 L11 7.5 L8.8 9 C9.8 11.4 12.6 14.2 15 15.2 L16.5 13 L21 14.5 L21 18 C21 19.7 19.7 21 18 21 C10 20.4 3.6 14 3 6 C3 4.3 4.3 3 6 3 Z"
                  stroke={colors.indigo}
                  strokeWidth={1.8}
                  fill={colors.mist}
                  strokeLinejoin="round"
                />
              </Svg>
            )}
            <Text style={styles.callText}>{t("chat.callGroup")}</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        ref={list}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        ListHeaderComponent={
          <View style={styles.headerGap}>
            {/* Novi's own warning: the scam that matters most in a money chat. */}
            <View style={styles.safety}>
              <Text style={styles.safetyText}>{t("chat.safetyShort")}</Text>
            </View>
            {hasEarlier ? (
              <Pressable onPress={() => void earlier()} style={styles.earlier} accessibilityRole="button">
                <Text style={styles.earlierText}>{t("chat.earlier")}</Text>
              </Pressable>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loaded ? (
            <Text style={styles.empty}>{t("chat.empty")}</Text>
          ) : (
            <ActivityIndicator color={colors.indigo} style={styles.loading} />
          )
        }
      />
      <ErrorMessage messageKey={error} />
      {canWrite ? (
        <View style={styles.composer}>
          {!recording ? (
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t("chat.placeholder")}
              placeholderTextColor={colors.muted}
              accessibilityLabel={t("chat.placeholder")}
              multiline
              maxLength={MAX_LENGTH}
              style={styles.input}
            />
          ) : null}
          {typing ? (
            <Pressable
              onPress={() => void send()}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel={t("chat.send")}
              style={[styles.send, sending && styles.off]}
            >
              <Svg width={22} height={22} viewBox="0 0 24 24">
                <Path d="M4 12 L20 4 L14 20 L11 13 Z" fill={colors.white} stroke={colors.white} strokeLinejoin="round" />
              </Svg>
            </Pressable>
          ) : (
            <VoiceButton disabled={sending} onRecording={setRecording} onSend={sendVoice} />
          )}
        </View>
      ) : (
        <Text style={styles.readOnly}>{t("chat.readOnly")}</Text>
      )}
    </KeyboardAvoidingView>
  );
}

// A small sound wave; the part already heard is darker.
function Wave({ done, mine }: { done: number; mine: boolean }) {
  const bars = [6, 14, 20, 10, 16, 8, 22, 12, 6, 16, 10, 20, 8, 14, 6, 12, 18, 6];
  const heard = Math.round(done * bars.length);
  const on = mine ? colors.white : colors.indigo;
  const off = mine ? "rgba(255,255,255,0.45)" : colors.crackle;
  return (
    <Svg width={126} height={26} viewBox="0 0 126 26">
      {bars.map((h, i) => (
        <Rect key={i} x={i * 7} y={13 - h / 2} width={3} height={h} rx={1.5} fill={i < heard ? on : off} />
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    minHeight: 56,
  },
  cal: { width: 44, borderRadius: 10, borderWidth: 1.5, borderColor: colors.indigo, overflow: "hidden", alignItems: "center" },
  calTop: {
    alignSelf: "stretch",
    textAlign: "center",
    backgroundColor: colors.accent,
    color: colors.white,
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    paddingVertical: 1,
  },
  calDay: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.indigo, paddingVertical: 2 },
  stripText: { flex: 1 },
  stripTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  stripSub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  stripLink: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.indigo },
  callBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  call: {
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    backgroundColor: colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  callText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.indigo },
  list: { paddingHorizontal: 16, paddingVertical: 12, gap: 10, flexGrow: 1 },
  headerGap: { gap: 10, marginBottom: 4 },
  safety: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    borderRadius: 12,
    padding: 10,
    borderLeftWidth: 6,
    borderLeftColor: colors.accent,
  },
  safetyText: { fontFamily: fonts.bodySemiBold, fontSize: 14, lineHeight: 20, color: colors.ink },
  earlier: { alignSelf: "center", paddingVertical: 8, paddingHorizontal: 14 },
  earlierText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.indigo, textDecorationLine: "underline" },
  empty: { fontFamily: fonts.body, fontSize: 16, color: colors.muted, textAlign: "center", marginTop: 32 },
  loading: { marginTop: 32 },
  line: { flexDirection: "row" },
  lineMine: { justifyContent: "flex-end" },
  bubble: { maxWidth: "82%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  voiceBubble: { minWidth: 230 },
  bubbleOther: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.indigo, borderBottomLeftRadius: 4 },
  bubbleMine: { backgroundColor: colors.indigo, borderBottomRightRadius: 4 },
  bubbleHidden: { backgroundColor: colors.line, borderColor: colors.line },
  author: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.accent },
  body: { fontFamily: fonts.body, fontSize: 17, lineHeight: 24, color: colors.ink },
  bodyMine: { color: colors.white },
  hiddenText: { fontStyle: "italic", color: colors.muted },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  play: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    alignItems: "center",
    justifyContent: "center",
  },
  playMine: { borderColor: colors.white },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  time: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  timeMine: { color: colors.mist },
  event: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.mist,
    borderRadius: 18,
    paddingVertical: 6,
    paddingHorizontal: 12,
    maxWidth: "94%",
  },
  eventText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.indigo, flexShrink: 1 },
  eventTime: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  joinText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.problem, textDecorationLine: "underline" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1.5,
    borderTopColor: colors.indigo,
    backgroundColor: colors.card,
    minHeight: 70,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontFamily: fonts.body,
    fontSize: 17,
    color: colors.ink,
    backgroundColor: colors.shell,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.indigo,
  },
  off: { opacity: 0.4 },
  readOnly: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.muted,
    textAlign: "center",
    padding: 16,
    borderTopWidth: 1.5,
    borderTopColor: colors.indigo,
  },
});
