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

// Starts in the phone's language when Novi supports it; otherwise in French,
// Togo's official language. The member chooses on the first screen.
function deviceLanguage(): AppLanguage {
  const code = getLocales()[0]?.languageCode;
  if (code === "ee") return "EE";
  if (code === "en") return "EN";
  return "FR";
}

function toI18nCode(language: AppLanguage): "en" | "fr" | "ee" {
  return language === "EN" ? "en" : language === "FR" ? "fr" : "ee";
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