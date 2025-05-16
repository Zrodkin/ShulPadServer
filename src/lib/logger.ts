export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// Set the minimum log level based on environment
const MIN_LOG_LEVEL = process.env.NODE_ENV === "production" ? LogLevel.INFO : LogLevel.DEBUG

// Helper function to safely stringify errors
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }
  return String(error)
}

// Helper function to safely extract data from errors
function extractErrorData(error: unknown): Record<string, any> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...((error as any).response?.data && { responseData: (error as any).response.data }),
    }
  }
  return { rawError: String(error) }
}

export function log(level: LogLevel, message: string, data?: any) {
  if (level >= MIN_LOG_LEVEL) {
    const timestamp = new Date().toISOString()
    const levelName = LogLevel[level]

    // If data contains an error, format it properly
    if (data && data.error) {
      data = {
        ...data,
        error: extractErrorData(data.error),
      }
    }

    const logMessage = {
      timestamp,
      level: levelName,
      message,
      ...(data && { data }),
    }

    // In production, you might want to send this to a logging service
    console.log(JSON.stringify(logMessage))
  }
}

export const logger = {
  debug: (message: string, data?: any) => log(LogLevel.DEBUG, message, data),
  info: (message: string, data?: any) => log(LogLevel.INFO, message, data),
  warn: (message: string, data?: any) => log(LogLevel.WARN, message, data),
  error: (message: string, data?: any) => log(LogLevel.ERROR, message, data),
}
