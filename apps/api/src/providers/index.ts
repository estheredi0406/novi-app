import type { IdentityProvider } from "./identity/IdentityProvider.js";
import { MockAnidProvider } from "./identity/MockAnidProvider.js";
import type { SmsProvider } from "./sms/SmsProvider.js";
import { MockSmsProvider } from "./sms/MockSmsProvider.js";

// The one place that decides which implementation the API uses. Everything
// else depends only on the interfaces, so replacing a mock with a real
// provider changes this file and nothing else (D3).
export const sms: SmsProvider = new MockSmsProvider();
export const identity: IdentityProvider = new MockAnidProvider();