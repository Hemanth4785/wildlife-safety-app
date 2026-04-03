/**
 * Centralized logging utility
 * Allows for easy switching between development and production logging
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const isDevelopment = __DEV__;

class Logger {
  private shouldLog(level: LogLevel): boolean {
    if (!isDevelopment) {
      // In production, only log errors and warnings
      return level === 'error' || level === 'warn';
    }
    return true;
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    switch (level) {
      case 'debug':
        console.log(prefix, message, ...args);
        break;
      case 'info':
        console.info(prefix, message, ...args);
        break;
      case 'warn':
        console.warn(prefix, message, ...args);
        break;
      case 'error':
        console.error(prefix, message, ...args);
        // In production, send to error tracking service
        if (!isDevelopment) {
          // TODO: Integrate with error tracking (Sentry, Bugsnag, etc.)
        }
        break;
    }
  }

  debug(message: string, ...args: any[]): void {
    this.formatMessage('debug', message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.formatMessage('info', message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.formatMessage('warn', message, ...args);
  }

  error(message: string, error?: Error | unknown, ...args: any[]): void {
    if (error instanceof Error) {
      this.formatMessage('error', message, error.message, error.stack, ...args);
    } else {
      this.formatMessage('error', message, error, ...args);
    }
  }
}

export const logger = new Logger();
