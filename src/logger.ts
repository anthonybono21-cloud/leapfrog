// ─── Structured JSON Logger ───────────────────────────────────────────────
//
// Zero-dependency structured logger that writes JSON to stderr.
// MCP servers use stderr for logging (stdout is reserved for the protocol).
//
// Control verbosity via LEAP_LOG_LEVEL env var: debug | info | warn | error
// Default: info

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private minLevel: LogLevel;

  constructor() {
    const envLevel = process.env.LEAP_LOG_LEVEL as LogLevel | undefined;
    this.minLevel =
      envLevel && envLevel in LOG_LEVELS ? envLevel : 'info';
  }

  private log(level: LogLevel, event: string, data?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.minLevel]) return;

    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      event,
      pid: process.pid,
      ...data,
    };

    process.stderr.write(JSON.stringify(entry) + '\n');
  }

  debug(event: string, data?: Record<string, unknown>): void {
    this.log('debug', event, data);
  }

  info(event: string, data?: Record<string, unknown>): void {
    this.log('info', event, data);
  }

  warn(event: string, data?: Record<string, unknown>): void {
    this.log('warn', event, data);
  }

  error(event: string, data?: Record<string, unknown>): void {
    this.log('error', event, data);
  }
}

export const logger = new Logger();
export type { LogLevel };
export default logger;
