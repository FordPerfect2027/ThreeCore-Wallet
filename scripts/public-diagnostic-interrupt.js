// Install handlers only while a public read is active; never touch other handlers.
export class DiagnosticInterruptError extends Error {
  constructor(name) {
    super("Read-only diagnostic cancelled by " + name);
    this.name = "DiagnosticInterruptError";
    this.code = "CLI_INTERRUPTED";
    this.exitCode = name === "SIGTERM" ? 143 : 130;
  }
}

export async function withDiagnosticInterrupt(operation, events = process) {
  const controller = new AbortController();
  let interruption;
  const stop = name => {
    if (interruption) return;
    interruption = new DiagnosticInterruptError(name);
    controller.abort();
  };
  const onInterrupt = () => stop("SIGINT");
  const onTerminate = () => stop("SIGTERM");
  events.on("SIGINT", onInterrupt);
  try {
    events.on("SIGTERM", onTerminate);
    try {
      const result = await operation(controller.signal);
      if (interruption) throw interruption;
      return result;
    } catch (error) {
      throw interruption ?? error;
    }
  } finally {
    events.removeListener("SIGINT", onInterrupt);
    events.removeListener("SIGTERM", onTerminate);
  }
}
