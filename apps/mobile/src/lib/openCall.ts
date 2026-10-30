import { type Href, router } from "expo-router";
import { Linking, NativeModules, TurboModuleRegistry } from "react-native";

// D85: a group call opens inside Novi, in a full-screen page, so she never
// leaves the app. A phone with an older Novi (built before the in-app call)
// has no web view inside it: the call then opens in her browser, as before.
export function canCallInApp(): boolean {
  try {
    return Boolean(
      TurboModuleRegistry.get("RNCWebViewModule") ??
      NativeModules.RNCWebViewModule,
    );
  } catch {
    return false;
  }
}

export async function openCall(url: string, title: string): Promise<void> {
  if (canCallInApp()) {
    router.push({
      pathname: "/call",
      params: { url, title },
    } as unknown as Href);
  } else {
    await Linking.openURL(url);
  }
}
