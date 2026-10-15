import type { errors } from "@novi/shared";
import type en from "./en.json";

// Every key path in a translation file, written with dots, e.g. "auth.pinLocked".
type KeyPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${KeyPaths<T[K]>}`;
}[keyof T & string];

// Every message key the API can send, taken from @novi/shared.
type ApiMessageKey = (typeof errors)[keyof typeof errors]["messageKey"];

type Untranslated = Exclude<ApiMessageKey, KeyPaths<typeof en>>;

// Fails to compile, naming the key, if the API can send an error that has no
// English text. Nothing imports this file; the type check reads it.
export const everyApiErrorIsTranslated: [Untranslated] extends [never] ? true : Untranslated = true;