import { Stack } from "expo-router";
import { usePushNotifications } from "../../lib/notifications";
import { colors } from "../../theme/colors";

// All the logged-in screens. The root layout only shows this folder once she
// has unlocked Novi. Notifications start here (D79).
export default function MemberLayout() {
  usePushNotifications();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.shell } }} />;
}
