import dns from "node:dns/promises";
import net from "node:net";

function ipToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function prefixToMask(prefix: number): number {
  return prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
}

const BLOCKED_V4: Array<{ net: number; mask: number }> = [
  { net: ipToInt("10.0.0.0"), mask: prefixToMask(8) },      // RFC1918
  { net: ipToInt("172.16.0.0"), mask: prefixToMask(12) },   // RFC1918
  { net: ipToInt("192.168.0.0"), mask: prefixToMask(16) },  // RFC1918
  { net: ipToInt("127.0.0.0"), mask: prefixToMask(8) },     // Loopback
  { net: ipToInt("169.254.0.0"), mask: prefixToMask(16) },  // Link-local + cloud metadata
  { net: ipToInt("0.0.0.0"), mask: prefixToMask(8) },       // "This" network
  { net: ipToInt("100.64.0.0"), mask: prefixToMask(10) },   // Shared address space
  { net: ipToInt("192.0.0.0"), mask: prefixToMask(24) },    // IETF Protocol Assignments
  { net: ipToInt("198.18.0.0"), mask: prefixToMask(15) },   // Benchmarking
  { net: ipToInt("240.0.0.0"), mask: prefixToMask(4) },     // Reserved
];

function isBlockedV4(ip: string): boolean {
  const ipInt = ipToInt(ip);
  return BLOCKED_V4.some(({ net, mask }) => (ipInt & mask) === (net & mask));
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("::ffff:") || // IPv4-mapped
    lower.startsWith("fc") ||      // Unique local (ULA)
    lower.startsWith("fd") ||      // Unique local (ULA)
    lower.startsWith("fe80")       // Link-local
  );
}

/**
 * Validate a URL against SSRF rules. Throws with a descriptive message if blocked.
 * Checks: protocol allowlist, direct IP ranges, DNS resolution.
 */
export async function validateUrl(urlString: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error(`Invalid URL: ${urlString}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Disallowed URL protocol: ${url.protocol}`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  if (hostname === "localhost") {
    throw new Error("SSRF blocked: localhost is not allowed");
  }

  if (net.isIPv4(hostname)) {
    if (isBlockedV4(hostname)) {
      throw new Error(`SSRF blocked: private/reserved address ${hostname}`);
    }
    return;
  }

  if (net.isIPv6(hostname)) {
    if (isBlockedV6(hostname)) {
      throw new Error(`SSRF blocked: private/reserved address ${hostname}`);
    }
    return;
  }

  // DNS resolution — check all resolved IPs
  const [v4, v6] = await Promise.all([
    dns.resolve4(hostname).catch(() => [] as string[]),
    dns.resolve6(hostname).catch(() => [] as string[]),
  ]);

  for (const ip of v4) {
    if (isBlockedV4(ip)) {
      throw new Error(`SSRF blocked: ${hostname} resolves to private address ${ip}`);
    }
  }

  for (const ip of v6) {
    if (isBlockedV6(ip)) {
      throw new Error(`SSRF blocked: ${hostname} resolves to private address ${ip}`);
    }
  }
}

/** Extract all http/https URLs embedded in a shell command string. */
export function extractUrls(command: string): string[] {
  const matches = command.match(/https?:\/\/[^\s'"`;|&><\\)]+/gi) ?? [];
  return Array.from(new Set(matches));
}
