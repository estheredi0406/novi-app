import type { GroupSummary } from "@novi/shared";
import { type Href, router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg from "react-native-svg";
import { listMyGroups } from "../api/groups";
import { formatDay, formatFcfa } from "../lib/format";
import { payTarget } from "../lib/hub";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";
import { Cowrie } from "./art/Cowrie";
import { LineIcon, type LineIconName } from "./LineIcon";
import { sheetColumn } from "./WebFrame";

// The bar at the bottom of every main screen (D92), as in the bank and mobile
// money apps people already use: four places and, raised in the middle, an
// orange Payer with a cowrie, West Africa's old money. Payer goes straight to
// the one round she owes; if she owes in several groups it asks which one,
// and if she owes nothing it says so.
export type Tab = "home" | "groups" | "record" | "me";
const ROUTES: Record<Tab, string> = { home: "/home", groups: "/groups", record: "/record", me: "/me" };
const ICONS: Record<Tab, LineIconName> = { home: "home", groups: "groups", record: "clock", me: "user" };


export function openRound(group: GroupSummary) {
  if (!group.currentRound) return;
  router.push({
    pathname: "/groups/[id]/rounds/[number]",
    params: { id: group.id, number: String(group.currentRound.number) },
  });
}

export function CowrieMark({ size = 30, fill = "#FFF6E6", rotate = 35 }: { size?: number; fill?: string; rotate?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Cowrie cx={12} cy={12} rx={6.2} ry={10.5} rotate={rotate} fill={fill} strokeWidth={1.3} />
    </Svg>
  );
}

export function BottomBar({ active }: { active: Tab | null }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [owing, setOwing] = useState<GroupSummary[]>([]);

  async function pay() {
    setLoading(true);
    try {
      const target = payTarget(await listMyGroups());
      if (target.kind === "one") openRound(target.group);
      else {
        setOwing(target.kind === "pick" ? target.groups : []);
        setPicking(true);
      }
    } catch {
      setOwing([]);
      setPicking(true);
    } finally {
      setLoading(false);
    }
  }

  const tab = (key: Tab) => {
    const on = key === active;
    return (
      <Pressable
        key={key}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        onPress={() => (on ? undefined : router.replace(ROUTES[key] as Href))}
        style={styles.tab}
      >
        <LineIcon name={ICONS[key]} color={on ? colors.lagoon : colors.muted} />
        <Text style={[styles.label, on && styles.on]}>{t(`nav.${key}`)}</Text>
      </Pressable>
    );
  };

  return (
    <>
      <View style={[styles.bar, { paddingBottom: Math.max(6, insets.bottom) }]} accessibilityRole="tablist">
        {tab("home")}
        {tab("groups")}
        <Pressable accessibilityRole="button" accessibilityLabel={t("nav.pay")} onPress={() => void pay()} style={styles.tab}>
          <View style={styles.payDisc}>
            {loading ? <ActivityIndicator color={colors.white} /> : <CowrieMark size={36} />}
          </View>
          <Text style={[styles.label, styles.payLabel]}>{t("nav.pay")}</Text>
        </Pressable>
        {tab("record")}
        {tab("me")}
      </View>

      <Modal visible={picking} transparent animationType="slide" onRequestClose={() => setPicking(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPicking(false)} accessibilityLabel={t("hub.close")} />
        <SafeAreaView edges={["bottom"]} style={[styles.sheet, sheetColumn]}>
          <View style={styles.handle} />
          {owing.length > 0 ? (
            <>
              <Text style={styles.sheetTitle}>{t("hub.pickTitle")}</Text>
              {owing.map((g) => (
                <Pressable
                  key={g.id}
                  accessibilityRole="button"
                  onPress={() => {
                    setPicking(false);
                    openRound(g);
                  }}
                  style={styles.pick}
                >
                  <View style={styles.pickText}>
                    <Text style={styles.pickName}>{g.name}</Text>
                    <Text style={styles.pickSub}>
                      {t("hub.pickLine", {
                        amount: formatFcfa(g.amountFcfa),
                        date: g.currentRound ? formatDay(g.currentRound.dueDate) : "",
                      })}
                    </Text>
                  </View>
                  <LineIcon name="chevron" color={colors.action} />
                </Pressable>
              ))}
            </>
          ) : (
            <>
              <Text style={styles.sheetTitle}>{t("hub.nothingTitle")}</Text>
              <Text style={styles.sheetText}>{t("hub.nothingText")}</Text>
            </>
          )}
          <Pressable accessibilityRole="button" onPress={() => setPicking(false)} style={styles.done}>
            <Text style={styles.doneText}>{t("hub.close")}</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: "center", gap: 3, minHeight: 52, justifyContent: "flex-start" },
  label: { textAlign: "center", fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.muted },
  on: { fontFamily: fonts.bodyBold, color: colors.lagoon },
  payDisc: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginTop: -30,
    backgroundColor: colors.accent,
    borderWidth: 5,
    borderColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: colors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  payLabel: { fontFamily: fonts.bodyBold, color: colors.accent },
  backdrop: { flex: 1, backgroundColor: "rgba(6,41,74,0.5)" },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 10,
  },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line, marginBottom: 6 },
  sheetTitle: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.indigo },
  sheetText: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.muted },
  pick: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  pickText: { flex: 1, gap: 2 },
  pickName: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink },
  pickSub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  done: { alignSelf: "center", paddingVertical: 12, paddingHorizontal: 24 },
  doneText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.lagoon },
});
