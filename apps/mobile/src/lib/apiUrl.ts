import { Platform } from "react-native";

// Where Novi's server is. The app on a phone is built with its address
// (EXPO_PUBLIC_API_URL). D119: the web version is served by that same server
// (at /app), so when built without an address it uses the page's own.
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : "");
