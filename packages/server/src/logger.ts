import pino from "pino";
import { config } from "./config";

export const logger = pino({
  level: config.logLevel,
  base: { service: "personabot" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "*.clientSecret",
      "*.client_secret",
      "*.apiKey",
      "*.api_key",
      "*.accessToken",
      "*.access_token",
      "password",
      "*.password",
    ],
    censor: "[redacted]",
  },
});

export type Logger = typeof logger;

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
