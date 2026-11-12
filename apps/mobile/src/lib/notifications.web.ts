// D128: the web version (D119) gets no phone notifications. The browser has
// no Expo push token, and expo-notifications' hooks are not built for the web
// (calling them stopped the page from opening). Metro picks this file on the
// web instead of notifications.ts.
export function usePushNotifications(): void {}
