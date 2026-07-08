type LogFields = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", message: string, fields: LogFields) {
  console.log(JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...fields }));
}

export const logger = {
  info: (message: string, fields: LogFields = {}) => emit("info", message, fields),
  warn: (message: string, fields: LogFields = {}) => emit("warn", message, fields),
  error: (message: string, fields: LogFields = {}) => emit("error", message, fields),
};
