import { useEffect, useState } from "react";
import { memberRequest, publicRequest } from "./client";

// What this server allows (D111): Rwandan numbers on the pilot server, and
// the pilot's SMS inbox. Asked once per launch; until it answers, the app
// behaves as the product does (Togo only, no inbox).
export type ServerConfig = { pilotRwanda: boolean; pilotSmsInbox: boolean };

const PRODUCT: ServerConfig = { pilotRwanda: false, pilotSmsInbox: false };
let cached: Promise<ServerConfig> | null = null;

export function getConfig(): Promise<ServerConfig> {
  cached ??= publicRequest<ServerConfig>("GET", "/v1/config").catch(() => {
    cached = null;
    return PRODUCT;
  });
  return cached;
}

export function useServerConfig(): ServerConfig {
  const [config, setConfig] = useState<ServerConfig>(PRODUCT);
  useEffect(() => {
    let live = true;
    void getConfig().then((c) => live && setConfig(c));
    return () => {
      live = false;
    };
  }, []);
  return config;
}

export type PilotSms = { id: string; at: string; text: string; real: boolean };

// D111: on the pilot, the SMS her phone would have received.
export const getMySms = () => memberRequest<{ enabled: boolean; messages: PilotSms[] }>("GET", "/v1/me/sms");
