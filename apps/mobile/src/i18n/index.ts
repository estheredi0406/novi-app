import { getLocales } from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
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

export function setAppLanguage(language: AppLanguage): void {
  void i18n.changeLanguage(toI18nCode(language));
}

export default i18n;