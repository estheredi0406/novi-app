// Sends notifications to phones (D79). A message reaches every phone where
// the member is logged in. Never throws: a notification is a courtesy, the
// money and the chat work without it.
export type PushMessage = {
  to: string; // the phone's Expo push token
  title: string;
  body: string;
  data: { url: string }; // the screen to open when she taps it
  // Android: "money" and "calls" ring with priority; chat is quieter.
  channelId: "money" | "calls" | "chat";
};

export interface PushProvider {
  send(messages: PushMessage[]): Promise<void>;
}
