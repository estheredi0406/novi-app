import { requireOptionalNativeModule } from "expo";

// D91: a photo of a document, taken with the camera or chosen from the
// phone, sent as base64. A Novi built before photos were added has no
// picker inside it: canPickPhotos() says so, and the screen explains that
// the documents can be brought to the agency instead.
type Picker = typeof import("expo-image-picker");

let picker: Picker | null | undefined;
function load(): Picker | null {
  if (picker === undefined) {
    picker = requireOptionalNativeModule("ExponentImagePicker")
      ? (require("expo-image-picker") as Picker)
      : null;
  }
  return picker;
}

export function canPickPhotos(): boolean {
  return load() !== null;
}

export type Photo = { mime: string; base64: string };
export type PickResult = Photo | "cancelled" | "denied" | "tooLarge";

// About 2.5 MB once decoded: the server's limit.
const MAX_BASE64 = 3_300_000;

export async function pickPhoto(
  source: "camera" | "library",
): Promise<PickResult> {
  const p = load();
  if (!p) return "denied";
  const permission =
    source === "camera"
      ? await p.requestCameraPermissionsAsync()
      : await p.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return "denied";
  const options = {
    mediaTypes: ["images"] as "images"[],
    quality: 0.45,
    base64: true,
    exif: false,
  };
  const result =
    source === "camera"
      ? await p.launchCameraAsync(options)
      : await p.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset?.base64) return "cancelled";
  if (asset.base64.length > MAX_BASE64) return "tooLarge";
  return { mime: asset.mimeType ?? "image/jpeg", base64: asset.base64 };
}
