import type { AuthTokens } from "@novi/shared";
import * as Crypto from "expo-crypto";
import * as Native from "expo-secure-store";
import { Platform } from "react-native";
import type { AppLanguage } from "../i18n";

// Everything Novi keeps on the phone, in the phone's encrypted keystore
// (Keychain on iPhone, Keystore on Android). The PIN is never stored.
// D128: a browser has no keystore, and expo-secure-store does nothing on the
// web (the page stayed blank). The web version (D119) keeps the same few
// values in the browser's own storage for this site, as any website keeps
// its sign-in; the PIN is still never stored, and the session still ends
// with the usual expiry and sign-out.
const web = {
  getItemAsync: async (key: string): Promise<string | null> => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItemAsync: async (key: string, value: string): Promise<void> => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Private browsing with storage off: she signs in again next time.
    }
  },
  deleteItemAsync: async (key: string): Promise<void> => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing kept, nothing to remove.
    }
  },
};
const SecureStore = Platform.OS === "web" ? web : Native;
const KEYS = {
  accessToken: "novi.accessToken",
  refreshToken: "novi.refreshToken",
  installationId: "novi.installationId",
  language: "novi.language",
  phone: "novi.phone",
  displayName: "novi.displayName",
} as const;

// This phone's identity for the API, created once on first use.
export async function getInstallationId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEYS.installationId);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync(KEYS.installationId, id);
  return id;
}

export async function saveTokens(tokens: AuthTokens): Promise<void> {
  await SecureStore.setItemAsync(KEYS.accessToken, tokens.accessToken);
  await SecureStore.setItemAsync(KEYS.refreshToken, tokens.refreshToken);
}

export async function getTokens(): Promise<{ accessToken: string; refreshToken: string } | null> {
  const accessToken = await SecureStore.getItemAsync(KEYS.accessToken);
  const refreshToken = await SecureStore.getItemAsync(KEYS.refreshToken);
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.accessToken);
  await SecureStore.deleteItemAsync(KEYS.refreshToken);
}

// Who uses this phone, so the unlock screen can greet her and log her in
// with only her PIN.
export async function saveMember(phone: string, displayName: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.phone, phone);
  await SecureStore.setItemAsync(KEYS.displayName, displayName);
}

export async function getMember(): Promise<{ phone: string; displayName: string } | null> {
  const phone = await SecureStore.getItemAsync(KEYS.phone);
  const displayName = await SecureStore.getItemAsync(KEYS.displayName);
  return phone && displayName ? { phone, displayName } : null;
}

export async function saveLanguage(language: AppLanguage): Promise<void> {
  await SecureStore.setItemAsync(KEYS.language, language);
}

export async function getSavedLanguage(): Promise<AppLanguage | null> {
  const value = await SecureStore.getItemAsync(KEYS.language);
  return value === "EN" || value === "FR" || value === "EE" ? value : null;
}