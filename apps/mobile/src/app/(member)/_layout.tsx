import { Stack } from "expo-router";
import { usePushNotifications } from "../../lib/notifications";
import { colors } from "../../theme/colors";

// Every screen of a logged-in member: home, groups, invitations. The root
// layout shows this whole folder only once she has unlocked Novi, so a new
// member screen is protected just by being placed here. Phone notifications
// start here too, once she is logged in (D79).
export default function MemberLayout() {
  usePushNotifications();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.shell } }} />;
}
