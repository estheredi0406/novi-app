import type { ChatMessage } from "@novi/shared";
import { type Href, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Speech from "expo-speech";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { errorKey } from "../../../../api/client";
import { getGroup, hideMessage, listMessages, postMessage } from "../../../../api/groups";
import { BackHeader } from "../../../../components/BackHeader";
import { ErrorMessage } from "../../../../components/ErrorMessage";
import { HeaderBand } from "../../../../components/HeaderBand";
import { Cowrie } from "../../../../components/art/Cowrie";
import { meetingWhen } from "../../../../lib/meetingTime";
import { colors } from "../../../../theme/colors";
import { fonts } from "../../../../theme/typography";

// The group's chat (D70): where the members remind, encourage and agree,
// as they would at the market. Novi adds a line when money moves. New lines
// are fetched every few seconds while the screen is open. Each line can be
// heard, for members who prefer listening to reading.
const EVERY_MS = 5000;
const MAX_LENGTH = 500;

export default function ChatScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [canWrite, setCanWrite] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<FlatList<ChatMessage>>(null);
  const latest = useRef<string | null>(null);

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

  useEffect(() => {
    void getGroup(id).then((g) => setName(g.name), () => undefined);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function poll() {
        try {
          const first = latest.current === null;
          const page = await listMessages(id, first ? {} : { after: latest.current as string });
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
        void Speech.stop();
      };
    }, [id, merge]),
  );

  async function earlier() {
    const first = messages[0];
    if (!first) return;
    try {
      const page = await listMessages(id, { before: first.id });
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
      merge([await postMessage(id, body)]);
      setDraft("");
      setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setSending(false);
    }
  }

  function hide(message: ChatMessage) {
    Alert.alert(t("chat.hideTitle"), t(message.mine ? "chat.hideMine" : "chat.hideOther"), [
      { text: t("chat.keep"), style: "cancel" },
      {
        text: t("chat.hide"),
        style: "destructive",
        onPress: () =>
          void hideMessage(id, message.id).then(
            (hidden) => merge([hidden]),
            (err: unknown) => setError(errorKey(err)),
          ),
      },
    ]);
  }

  function eventText(m: ChatMessage): string {
    const who = m.authorName ?? "";
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

  function say(text: string) {
    void Speech.stop();
    Speech.speak(text, { language: i18n.language === "en" ? "en-US" : "fr-FR", rate: 0.9 });
  }

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(i18n.language === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit" });

  function renderItem({ item }: { item: ChatMessage }) {
    if (item.kind === "EVENT") {
      const text = eventText(item);
      return (
        <Pressable
          onPress={() => (item.meeting ? router.push(`/groups/${id}/meetings` as Href) : say(text))}
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
          <Text style={styles.eventTime}>{time(item.createdAt)}</Text>
        </Pressable>
      );
    }
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
            <Svg width={14} height={14} viewBox="0 0 24 24">
              <Path
                d="M5 9v6h4l5 4V5L9 9H5z M17 9a4 4 0 0 1 0 6"
                stroke={item.mine ? colors.white : colors.muted}
                strokeWidth={2.2}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <Text style={[styles.time, item.mine && styles.timeMine]}>{time(item.createdAt)}</Text>
          </View>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <HeaderBand>
        <BackHeader listenText={`${t("chat.title")}. ${name}. ${t("chat.safety")}`} />
        <Text style={styles.bandName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.bandSub}>{t("chat.title")}</Text>
      </HeaderBand>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
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
                <Text style={styles.safetyText}>{t("chat.safety")}</Text>
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
            <Pressable
              onPress={() => void send()}
              disabled={sending || draft.trim().length === 0}
              accessibilityRole="button"
              accessibilityLabel={t("chat.send")}
              style={[styles.send, (sending || draft.trim().length === 0) && styles.sendOff]}
            >
              <Svg width={22} height={22} viewBox="0 0 24 24">
                <Path d="M4 12 L20 4 L14 20 L11 13 Z" fill={colors.white} stroke={colors.white} strokeLinejoin="round" />
              </Svg>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.readOnly}>{t("chat.readOnly")}</Text>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.shell },
  fill: { flex: 1 },
  bandName: { fontFamily: fonts.display, fontSize: 26, color: colors.indigo },
  bandSub: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.muted },
  list: { paddingHorizontal: 16, paddingVertical: 12, gap: 10, flexGrow: 1 },
  headerGap: { gap: 10, marginBottom: 4 },
  safety: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    borderRadius: 12,
    padding: 12,
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
  bubbleOther: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.indigo,
    borderBottomLeftRadius: 4,
  },
  bubbleMine: { backgroundColor: colors.indigo, borderBottomRightRadius: 4 },
  bubbleHidden: { backgroundColor: colors.line, borderColor: colors.line },
  author: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.accent },
  body: { fontFamily: fonts.body, fontSize: 17, lineHeight: 24, color: colors.ink },
  bodyMine: { color: colors.white },
  hiddenText: { fontStyle: "italic", color: colors.muted },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 },
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
    maxWidth: "92%",
  },
  eventText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.indigo, flexShrink: 1 },
  eventTime: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1.5,
    borderTopColor: colors.indigo,
    backgroundColor: colors.card,
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
  sendOff: { opacity: 0.4 },
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
