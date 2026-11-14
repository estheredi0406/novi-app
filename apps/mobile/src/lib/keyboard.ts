import { useEffect, useState } from "react";
import { Keyboard } from "react-native";

// Whether the phone's keyboard is open, so a screen can fold what is not
// needed while she types (the group chat, D161).
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setOpen(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setOpen(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return open;
}
