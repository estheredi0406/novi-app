import "dotenv/config";
import { DailyMeetingProvider } from "../providers/meeting/DailyMeetingProvider.js";

// Checks the Daily key before a real meeting (D71): creates a private test
// room that opens now and closes in 15 minutes, prints a pass to join it as
// owner, and never prints the key. Run from apps/api:
//
//   npm run daily:probe
//
// Open the printed address on your phone: you should see Daily's call page
// with your microphone on and camera off. The room disappears by itself.

const key = process.env.DAILY_API_KEY;
if (!key) {
  console.error("DAILY_API_KEY is not set in apps/api/.env.");
  process.exit(1);
}

const daily = new DailyMeetingProvider(key);
const now = new Date();
const closesAt = new Date(now.getTime() + 15 * 60_000);
const room = await daily.createRoom({
  name: `novi-probe-${now.getTime()}`,
  opensAt: new Date(now.getTime() - 60_000),
  closesAt,
  maxParticipants: 3,
});
console.log(`Room created: ${room.name}, closes at ${closesAt.toLocaleTimeString()}`);
const url = await daily.joinUrl({
  roomName: room.name,
  roomUrl: room.url,
  userId: "probe",
  userName: "Test Novi",
  isOwner: true,
  closesAt,
  lang: "fr",
});
console.log(`Open this on your phone (valid 15 minutes):\n${url}`);
console.log(`Without the pass, the room refuses entry: ${room.url}`);
