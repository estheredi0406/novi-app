import { Alert as NativeAlert, Platform, type AlertButton } from "react-native";

// D119: React Native's Alert does nothing in a browser, so confirmations were
// silently cancelled on the web. This uses the browser's dialog there and the
// phone's dialog in the app.
function alert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== "web") {
    NativeAlert.alert(title, message, buttons);
    return;
  }
  const text = message ? `${title}\n\n${message}` : title;
  const actions = (buttons ?? []).filter((b) => b.style !== "cancel");
  if (actions.length === 0) {
    window.alert(text);
    (buttons ?? [])[0]?.onPress?.();
    return;
  }
  // One action: OK runs it. Several: the last one (the confirming one, as
  // the app writes them) runs on OK; Cancel runs the cancel button, if any.
  const go = actions[actions.length - 1];
  if (window.confirm(text)) go?.onPress?.();
  else (buttons ?? []).find((b) => b.style === "cancel")?.onPress?.();
}

export const Alert = { alert };
