/**
 * Test certificates for the signature and transport scenarios. The certificate authority and the leaf certificates
 * of the consumer's own tests (consumer/test/fixtures/tls) are used as they are; a leaf for another host name is
 * issued here by the test authority with the openssl program, valid from 2020 to 2120, so that no scenario depends
 * on the date of the machine.
 *
 * The leaf keys are Ed25519 keys made by openssl, imported as publisher signing keys, so that an object can be signed
 * with the key a certificate names.
 */
import { spawnSync } from "node:child_process";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { publisher, ROOT } from "./world.mjs";

const FIXTURES = resolve(ROOT, "consumer", "test", "fixtures", "tls");
const START = "20200101000000Z";
const END = "21200101000000Z";

/** A file of the consumer's TLS fixtures as text. */
export const fixture = (name) => readFileSync(join(FIXTURES, name), "utf8");

function openssl(args, cwd) {
  const r = spawnSync("openssl", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`openssl ${args.slice(0, 2).join(" ")} failed: ${r.stderr}`);
}

/** The base64 DER of a PEM certificate, as an x5c entry. */
export const x5cOf = (pem) => new X509Certificate(pem).raw.toString("base64");

async function signingKeyOf(keyPem) {
  const jwk = createPrivateKey(keyPem).export({ format: "jwk" });
  return publisher.importSigningKey(jwk);
}

/**
 * A new Ed25519 key and a certificate for `host`, in `dir`. `issuer` is "ca" (the test authority) or "self" (the
 * certificate signs itself). Returns { key, certificate (PEM) }.
 */
export async function issueCertificate(dir, host, issuer) {
  const keyFile = join(dir, `${host}-key.pem`);
  const csr = join(dir, `${host}.csr`);
  const certFile = join(dir, `${host}.pem`);
  openssl(["genpkey", "-algorithm", "Ed25519", "-out", keyFile], dir);
  openssl(["req", "-new", "-key", keyFile, "-subj", `/CN=${host}`, "-addext", `subjectAltName=DNS:${host}`, "-out", csr], dir);
  writeFileSync(
    join(dir, "ca.cnf"),
    [
      "[ ca ]",
      "default_ca = CA_default",
      "[ CA_default ]",
      `dir = ${dir}`,
      `database = ${join(dir, "index.txt")}`,
      `new_certs_dir = ${dir}`,
      `serial = ${join(dir, "serial")}`,
      "default_md = default",
      "policy = policy_any",
      "unique_subject = no",
      "copy_extensions = copy",
      "[ policy_any ]",
      "commonName = supplied",
      "",
    ].join("\n"),
  );
  writeFileSync(join(dir, "index.txt"), "");
  writeFileSync(join(dir, "serial"), "01\n");
  const common = ["ca", "-batch", "-config", join(dir, "ca.cnf"), "-in", csr, "-startdate", START, "-enddate", END, "-notext", "-out", certFile];
  if (issuer === "self") openssl([...common, "-selfsign", "-keyfile", keyFile], dir);
  else {
    writeFileSync(join(dir, "test-ca.pem"), fixture("ca.pem"));
    writeFileSync(join(dir, "test-ca-key.pem"), fixture("ca-key.pem"));
    openssl([...common, "-cert", join(dir, "test-ca.pem"), "-keyfile", join(dir, "test-ca-key.pem")], dir);
  }
  return { key: await signingKeyOf(readFileSync(keyFile, "utf8")), certificate: readFileSync(certFile, "utf8") };
}
