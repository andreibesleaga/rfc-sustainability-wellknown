/**
 * Entry point. Loads configuration from the environment, builds the gateway,
 * binds 0.0.0.0:$PORT (what Railway and every other container platform
 * require), and shuts down cleanly on SIGTERM/SIGINT.
 */
import { createGateway } from "./app";
import { loadConfig } from "./config";

export { createGateway, route, type Gateway } from "./app";
export { loadConfig, LIMITS, type GatewayConfig } from "./config";
export { loadRegistry, loadSubjectFile, subjectFromAdapter, type Subject } from "./registry";
export { buildIndex, renderIndexHtml, THIRD_PARTY_NOTICE, NO_DATA_NOTE } from "./index-page";
export { loadNoData, type NoDataEntry } from "./no-data";

/** Grace period for in-flight requests before the process is forced down. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const gw = await createGateway({ config });

  gw.server.listen(config.port, config.host, () => {
    process.stdout.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        event: "listening",
        host: config.host,
        port: config.port,
        subjects: [...gw.subjects.keys()],
        self: gw.self.document.target,
        dataDir: config.dataDir,
      }) + "\n",
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(
      JSON.stringify({ ts: new Date().toISOString(), level: "info", event: "shutdown", signal }) +
        "\n",
    );
    // Stop accepting new connections, let in-flight requests drain, then exit.
    const timer = setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    gw.server.close(() => {
      clearTimeout(timer);
      process.exit(0);
    });
    gw.server.closeIdleConnections?.();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "fatal",
        event: "startup-failed",
        error: err instanceof Error ? err.message : String(err),
      }) + "\n",
    );
    // A non-conformant or unreadable data file must stop the deploy, never be
    // served: Railway will surface the failed health check.
    process.exit(1);
  });
}
