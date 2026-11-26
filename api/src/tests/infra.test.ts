import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The security audit's infrastructure fixes (DECISIONS B43) live in config files, not in
// code a request runs through, so these tests read the files themselves. Each one fails
// if a later edit quietly undoes a fix.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(ROOT + path, "utf8");

type Compose = { services: Record<string, { networks?: string[]; ports?: string[]; volumes?: string[] }>; networks?: Record<string, { ipam?: { config?: { subnet: string }[] } }> };
type Step = { uses?: string; with?: { script?: string } };
type Workflow = { permissions?: Record<string, string>; jobs: Record<string, { steps?: Step[] }> };

describe("Caddy (findings 2 and 15)", () => {
  const caddyfile = read("Caddyfile");

  it("sends the security headers on every site, web app and API alike", () => {
    for (const header of [
      "Content-Security-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options",
      "Referrer-Policy", "Permissions-Policy",
    ]) {
      expect(caddyfile).toContain(header);
    }
    // Both site blocks import the shared snippet.
    expect(caddyfile.match(/import security_headers/g)).toHaveLength(2);
  });

  it("keeps the CSP to this site, Fragrantica's images, and no framing", () => {
    const csp = caddyfile.match(/Content-Security-Policy "([^"]+)"/)![1]!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("img-src 'self' data: https://fimgs.net");
    expect(csp).not.toMatch(/'unsafe-eval'|script-src[^;]*'unsafe-inline'|googleapis|gstatic/);
  });

  it("pins TLS 1.2 and up and hides the server software", () => {
    expect(caddyfile.match(/protocols tls1\.2 tls1\.3/g)).toHaveLength(2);
    expect(caddyfile).toMatch(/-Server\b/);
    expect(caddyfile).toMatch(/-Via\b/);
  });

  it("loads no fonts from Google, so the CSP can stay 'self'", () => {
    expect(read("web/src/index.css")).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(read("web/index.html")).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });
});

describe("the metadata service is the backup container's alone (finding 3)", () => {
  const compose = parse(read("docker-compose.prod.yml")) as Compose;
  const deploy = read(".github/workflows/deploy.yml");

  it("puts caddy, api, and db on the app network and only backup on the backup network", () => {
    expect(compose.services.caddy!.networks).toEqual(["app"]);
    expect(compose.services.api!.networks).toEqual(["app"]);
    expect(compose.services.db!.networks).toEqual(["app", "backup"]);
    expect(compose.services.backup!.networks).toEqual(["backup"]);
  });

  it("drops the app network's traffic to 169.254.169.254, using the compose file's subnet", () => {
    const subnet = compose.networks!.app!.ipam!.config![0]!.subnet;
    expect(subnet).toBe("172.30.0.0/24");
    expect(deploy).toContain(`iptables -I DOCKER-USER -s ${subnet} -d 169.254.169.254 -j DROP`);
    // And the backup network is not the one being dropped.
    expect(deploy).not.toContain(compose.networks!.backup!.ipam!.config![0]!.subnet);
  });

  it("proves the block after each deploy", () => {
    expect(deploy).toContain("The API container can reach the EC2 metadata service");
    expect(deploy).toContain("exec -T backup aws sts get-caller-identity > /dev/null");
  });

  it("mounts no Docker socket and publishes no database port", () => {
    for (const service of Object.values(compose.services)) {
      expect(JSON.stringify(service.volumes ?? [])).not.toContain("docker.sock");
    }
    expect(compose.services.db!.ports).toBeUndefined();
  });
});

describe("GitHub Actions (findings 4, 12, and 15)", () => {
  const workflows = [".github/workflows/ci.yml", ".github/workflows/deploy.yml"].map(
    (path) => [path, parse(read(path)) as Workflow] as const,
  );

  it("pins every third-party action to a full commit SHA", () => {
    const uses = workflows.flatMap(([, wf]) => Object.values(wf.jobs).flatMap((job) => (job.steps ?? []).map((s) => s.uses)));
    const external = uses.filter((u): u is string => typeof u === "string" && !u.startsWith("./"));
    expect(external.length).toBeGreaterThan(0);
    for (const ref of external) expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it("gives every workflow a read-only token by default", () => {
    for (const [, wf] of workflows) expect(wf.permissions).toEqual({ contents: "read" });
  });

  it("logs the server out of the registry even when the pull fails", () => {
    const deploy = read(".github/workflows/deploy.yml");
    const trap = deploy.indexOf("trap 'docker logout ghcr.io");
    expect(trap).toBeGreaterThan(-1);
    expect(trap).toBeLessThan(deploy.indexOf("docker login ghcr.io"));
  });

  it("never runs on pull_request_target or puts event text into a shell", () => {
    for (const path of [".github/workflows/ci.yml", ".github/workflows/deploy.yml"]) {
      const text = read(path);
      expect(text).not.toContain("pull_request_target");
      expect(text).not.toMatch(/\$\{\{\s*github\.event\./);
    }
  });
});

describe("the API image (finding 11)", () => {
  const dockerfile = read("api/Dockerfile");
  const prod = dockerfile.slice(dockerfile.indexOf(" AS prod"));

  it("installs production dependencies only and runs as the node user", () => {
    expect(prod).toContain("npm ci --omit=dev");
    expect(prod).toMatch(/^USER node$/m);
    expect(dockerfile).not.toMatch(/FROM dev AS prod/);
  });

  it("has what start and migrate need among the production dependencies", () => {
    const pkg = JSON.parse(read("api/package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies).toHaveProperty("tsx");
    expect(pkg.dependencies).toHaveProperty("node-pg-migrate");
  });
});

describe("local development (finding 14)", () => {
  it("publishes every dev port on this machine only by default", () => {
    const compose = parse(read("docker-compose.yml")) as Compose;
    const ports = Object.values(compose.services).flatMap((s) => s.ports ?? []);
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) expect(port).toMatch(/^\$\{DEV_BIND:-127\.0\.0\.1\}:/);
  });
});
