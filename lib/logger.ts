/**
 * Central logger using Pino. Structured JSON in production, readable format in dev.
 * Use child loggers for context: logger.child({ module: 'api' })
 */

import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";
const logLevel = process.env.LOG_LEVEL ?? (isDev ? "debug" : "info");

const base = pino({
  level: logLevel,
  base: undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss",
        ignore: "pid,hostname",
      },
    },
  }),
});

/** Default app logger. Use .child({ module: 'name' }) for scoped logs. */
export const logger = base;

/** Create a child logger with fixed context (e.g. module name). */
export function createLogger(module: string): pino.Logger {
  return base.child({ module });
}
