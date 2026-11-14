import Constants from "expo-constants";
import { type Href, router } from "expo-router";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { Platform } from "react-native";
import { memberRequest } from "../api/client";
import { colors } from "../theme/colors";

// Phone notifications (D79): asks permission once, sends the phone's token to
// the server, and opens the right screen when tapped. A refusal never breaks
// the app.

// While Novi is open, a notification still shows at the top, quietly.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Android groups notifications in channels that she can tune in her phone's
// settings: money and calls ring, chat is quieter.
async function channels() {
  if (Platform.OS !== "android") return;
  const base = { lightColor: colors.accent, vibrationPattern: [0, 250, 150, 250] };
  await Notifications.setNotificationChannelAsync("money", {
    ...base,
    name: "Argent (cotisations, cagnottes)",
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync("calls", {
    ...base,
    name: "Appels du groupe",
    importance: Notifications.AndroidImportance.MAX,
  });
  await Notifications.setNotificationChannelAsync("chat", {
    ...base,
    name: "Discussion du groupe",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

async function register(): Promise<void> {
  await channels();
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
  if (!granted) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await memberRequest<void>("PUT", "/v1/me/push-token", { token });
}

function openFrom(response: Notifications.NotificationResponse | null | undefined) {
  const url = response?.notification.request.content.data?.url;
  if (typeof url === "string" && url.startsWith("/")) router.push(url as Href);
}

// Used once, in the logged-in part of the app.
export function usePushNotifications(): void {
  const last = Notifications.useLastNotificationResponse();

  useEffect(() => {
    register().catch(() => undefined);
  }, []);

  // A tap that opened Novi from closed, or while it was running.
  useEffect(() => {
    if (last) openFrom(last);
  }, [last]);
}
