/**
 * CLI / config loader. Builds a {@link Publisher} from a JSON config and either
 * starts the standalone server or prints one document (`--once`).
 *
 * Config shape:
 * {
 *   "adapter":  { "type": "computed", "options": { ... } },
 *   "publisher":{ "normalize": {...}, "security": {...}, "cacheTtlMs": 0 },
 *   "server":   { "port": 8080, "maxAge": 86400 }
 * }
 */
import {
  climatiqAdapter,
  computedAdapter,
  keplerPrometheusAdapter,
  msSustainabilityAdapter,
  salesforceNzcAdapter,
  staticAdapter,
  staticFileAdapter,
  watershedAdapter,
} from "./adapters";
import { Publisher, PublisherOptions } from "./publisher";
import { createSustainabilityServer } from "./server";
import { SourceAdapter } from "./types";
import { readJson } from "./util";

const ADAPTER_FACTORIES: Record<string, (opts: any) => SourceAdapter> = {
  static: staticAdapter,
  "static-file": staticFileAdapter,
  computed: computedAdapter,
  "kepler-prometheus": keplerPrometheusAdapter,
  climatiq: climatiqAdapter,
  "salesforce-nzc": salesforceNzcAdapter,
  "ms-sustainability": msSustainabilityAdapter,
  watershed: watershedAdapter,
};

export interface PublisherConfig {
  adapter: { type: string; options: Record<string, unknown> };
  publisher?: PublisherOptions;
  server?: { port?: number; maxAge?: number; extraPaths?: string[] };
}

export function buildAdapter(type: string, options: Record<string, unknown>): SourceAdapter {
  const factory = ADAPTER_FACTORIES[type];
  if (!factory) {
    throw new Error(
      `Unknown adapter type "${type}". Known: ${Object.keys(ADAPTER_FACTORIES).join(", ")}`,
    );
  }
  return factory(options);
}

export function buildPublisher(config: PublisherConfig): Publisher {
  const adapter = buildAdapter(config.adapter.type, config.adapter.options ?? {});
  return new Publisher(adapter, config.publisher ?? {});
}

function parseArgs(argv: string[]): { config?: string; once: boolean; port?: number } {
  const out: { config?: string; once: boolean; port?: number } = { once: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config" || a === "-c") out.config = argv[++i];
    else if (a === "--once") out.once = true;
    else if (a === "--port" || a === "-p") out.port = Number(argv[++i]);
  }
  return out;
}

export async function runCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (!args.config) {
    process.stderr.write(
      "Usage: sustainability-publisher --config <config.json> [--once] [--port <n>]\n",
    );
    process.exit(2);
  }

  const config = readJson<PublisherConfig>(args.config);
  const publisher = buildPublisher(config);

  if (args.once) {
    const doc = await publisher.getDocument();
    process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
    return;
  }

  const port = args.port ?? config.server?.port ?? 8080;
  const server = createSustainabilityServer(publisher, {
    maxAge: config.server?.maxAge,
    extraPaths: config.server?.extraPaths,
  });
  server.listen(port, () => {
    process.stdout.write(
      `sustainability-publisher listening on http://localhost:${port}/.well-known/sustainability\n`,
    );
  });
}
