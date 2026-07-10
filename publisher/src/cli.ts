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
 *
 * `publisher.normalize.target` sets the mandatory `target` member (the
 * reporting subject) for adapters that do not supply one themselves; for an
 * origin-wide report use the origin's host (e.g. "example.com").
 */
import {
  carbonTxtApiAdapter,
  climatiqAdapter,
  co2jsAdapter,
  computedAdapter,
  keplerPrometheusAdapter,
  msSustainabilityAdapter,
  salesforceNzcAdapter,
  staticAdapter,
  staticFileAdapter,
  watershedAdapter,
} from "./adapters";
import { emitCarbonTxt } from "./carbontxt";
import { CarbonTxtServeOptions } from "./handler";
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
  co2js: co2jsAdapter,
  "carbontxt-api": carbonTxtApiAdapter,
  "salesforce-nzc": salesforceNzcAdapter,
  "ms-sustainability": msSustainabilityAdapter,
  watershed: watershedAdapter,
};

export interface PublisherConfig {
  adapter: { type: string; options: Record<string, unknown> };
  publisher?: PublisherOptions;
  server?: {
    port?: number;
    maxAge?: number;
    extraPaths?: string[];
    /** When set, also serve a bidirectional carbon.txt. */
    carbonTxt?: CarbonTxtServeOptions;
  };
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

interface CliArgs {
  config?: string;
  once: boolean;
  port?: number;
  emitCarbonTxt: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { once: false, emitCarbonTxt: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config" || a === "-c") out.config = argv[++i];
    else if (a === "--once") out.once = true;
    else if (a === "--emit-carbon-txt") out.emitCarbonTxt = true;
    else if (a === "--port" || a === "-p") out.port = Number(argv[++i]);
  }
  return out;
}

export async function runCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (!args.config) {
    process.stderr.write(
      "Usage: sustainability-publisher --config <config.json> [--once] [--emit-carbon-txt] [--port <n>]\n",
    );
    process.exit(2);
  }

  const config = readJson<PublisherConfig>(args.config);

  if (args.emitCarbonTxt) {
    const serve = config.server?.carbonTxt;
    if (!serve?.sustainabilityUrl) {
      throw new Error(
        "--emit-carbon-txt requires server.carbonTxt.sustainabilityUrl in the config",
      );
    }
    process.stdout.write(emitCarbonTxt({ ...serve, sustainabilityUrl: serve.sustainabilityUrl }));
    return;
  }

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
    carbonTxt: config.server?.carbonTxt,
  });
  server.listen(port, () => {
    process.stdout.write(
      `sustainability-publisher listening on http://localhost:${port}/.well-known/sustainability\n`,
    );
  });
}
