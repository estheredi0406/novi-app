import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

// Address of the Novi API, set in apps/mobile/.env.
// EXPO_PUBLIC_ values are built into the app, so this must never hold a secret.
const API_URL = process.env.EXPO_PUBLIC_API_URL;

// How long to wait for the API before reporting it unreachable.
const TIMEOUT_MS = 5000;

// What the screen can show: still checking, the API's answer, or no answer at all.
type HealthState =
  | { kind: "checking" }
  | { kind: "answered"; httpStatus: number; status: string; database: string }
  | { kind: "unreachable"; reason: string };

// Shape of the JSON body returned by GET /health.
type HealthBody = { status: string; database: string };

// Temporary Sprint 0 screen: proves the phone can reach the API and the database.
// Replaced by the sign-up flow in Sprint 1.
export default function App() {
  const [health, setHealth] = useState<HealthState>({ kind: "checking" });

  const checkHealth = useCallback(async () => {
    if (!API_URL) {
      setHealth({ kind: "unreachable", reason: "EXPO_PUBLIC_API_URL is not set" });
      return;
    }

    setHealth({ kind: "checking" });

    // Cancel the request if the API does not answer in time,
    // instead of leaving the screen waiting indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${API_URL}/health`, { signal: controller.signal });
      const body = (await response.json()) as HealthBody;
      setHealth({
        kind: "answered",
        httpStatus: response.status,
        status: body.status,
        database: body.database,
      });
    } catch {
      setHealth({ kind: "unreachable", reason: `No answer from ${API_URL}` });
    } finally {
      clearTimeout(timer);
    }
  }, []);

  // Check once when the screen first appears.
  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Novi</Text>

      {health.kind === "checking" && <Text style={styles.line}>Checking the API...</Text>}

      {health.kind === "answered" && (
        <>
          <Text style={styles.line}>HTTP {health.httpStatus}</Text>
          <Text style={styles.line}>API: {health.status}</Text>
          <Text style={styles.line}>Database: {health.database}</Text>
        </>
      )}

      {health.kind === "unreachable" && <Text style={styles.line}>{health.reason}</Text>}

      <Pressable style={styles.button} onPress={() => void checkHealth()}>
        <Text style={styles.buttonText}>Check again</Text>
      </Pressable>

      <StatusBar style="auto" />
    </View>
  );
}

// Colours from the Novi palette: shell background, indigo title, ink text, action button.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8F8FC",
    padding: 24,
  },
  title: { fontSize: 32, fontWeight: "800", color: "#22306B", marginBottom: 24 },
  line: { fontSize: 18, color: "#141833", marginBottom: 8 },
  button: {
    marginTop: 24,
    backgroundColor: "#2E42A6",
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 10,
  },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
});