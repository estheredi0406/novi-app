import { getLocales } from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getSavedLanguage, saveLanguage } from "../lib/storage";
import ee from "./ee.json";
import en from "./en.json";
import fr from "./fr.json";

export type AppLanguage = "EN" | "FR" | "EE";

// French must contain every key English has: if a key is missing, this line
// fails to compile. Ewe is not checked, because its texts are still awaiting
// review by a native speaker; missing Ewe keys fall back to French.
const frComplete: typeof en = fr;

// Ewe is offered once enough of it has been written or checked by a speaker
// (D78): until then, choosing it would only show French, which confuses a
// tester or a jury. Counted, not switched by hand, so it appears by itself.
const count = (node: unknown): number =>
  typeof node === "string" ? 1 : node && typeof node === "object" ? Object.values(node).reduce((n: number, v) => n + count(v), 0) : 0;
export const EWE_READY = count(ee) >= 40;

// The languages she can choose, Ewe first when it is ready.
export const APP_LANGUAGES: { language: AppLanguage; nameKey: string }[] = [
  ...(EWE_READY ? [{ language: "EE" as const, nameKey: "language.ee" }] : []),
  { language: "FR", nameKey: "language.fr" },
  { language: "EN", nameKey: "language.en" },
];

// Starts in the phone's language when Novi supports it; otherwise in French,
// Togo's official language. The member chooses on the first screen.
function deviceLanguage(): AppLanguage {
  const code = getLocales()[0]?.languageCode;
  if (code === "ee" && EWE_READY) return "EE";
  if (code === "en") return "EN";
  return "FR";
}

function toI18nCode(language: AppLanguage): "en" | "fr" | "ee" {
  return language === "EN" ? "en" : language === "EE" && EWE_READY ? "ee" : "fr";
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: frComplete },
    ee: { translation: ee },
  },
  lng: toI18nCode(deviceLanguage()),
  fallbackLng: { ee: ["fr"], default: ["en"] },
  interpolation: { escapeValue: false }, // React already protects displayed text
});

// Changes the language now and remembers it for the next launch.
export function setAppLanguage(language: AppLanguage): void {
  void i18n.changeLanguage(toI18nCode(language));
  void saveLanguage(language);
}

// At launch: the language she chose last time, if any.
export async function restoreSavedLanguage(): Promise<void> {
  const saved = await getSavedLanguage();
  if (saved) await i18n.changeLanguage(toI18nCode(saved));
}

export default i18n;

// The language currently shown, in the API's format.
export function currentLanguage(): AppLanguage {
  return i18n.language === "en" ? "EN" : i18n.language === "ee" ? "EE" : "FR";
}