import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const includeHistory = process.argv.includes("--history");
const violations = [];

const sensitivePathRules = [
  ["environment file", /(^|\/)\.env(?:\.|$)/i],
  ["local runtime data", /(^|\/)\.local(?:\/|$)/i],
  ["Chrome profile", /(^|\/)chrome-profile(?:\/|$)/i],
  ["browser capture", /\.(?:har)$/i],
  ["database", /\.(?:db|sqlite|sqlite3)$/i],
  ["private key or credential bundle", /(?:\.pem|\.key|\.p12|\.pfx|credentials[^/]*\.json|secrets?[^/]*\.json)$/i],
  ["local export", /\.(?:csv|xlsx|xls)$/i]
];

const secretRules = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["GitHub token", /(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/g],
  ["OpenAI-style token", /sk-[A-Za-z0-9_-]{20,}/g],
  ["AWS access key", /AKIA[0-9A-Z]{16}/g],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ["JWT", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ["credential in URL", /https?:\/\/[^\s/:]+:[^\s/@]+@/gi],
  ["LinkedIn session cookie", /(?:li_at|JSESSIONID|bscookie|bcookie)\s*[:=]\s*["'][^"'\s]{12,}/gi],
  ["assigned secret", /(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/gi],
  ["local Windows user path", /[A-Z]:\\Users\\[^\\\s]+/gi]
];

const allowedEmailDomains = new Set(["example.com", "example.test", "users.noreply.github.com"]);
const allowedProfileSlugs = /^(?:example|sample(?:-|$)|profile-name$|first-profile$|second-profile$|one$|two$|three$|\$\{)/i;

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: options.encoding ?? "utf8",
    maxBuffer: 128 * 1024 * 1024
  });
}

function report(category, source, content, index = 0) {
  const line = content.slice(0, index).split(/\r?\n/).length;
  violations.push({ category, source, line });
}

function scanContent(source, content) {
  for (const [category, expression] of secretRules) {
    expression.lastIndex = 0;
    const match = expression.exec(content);
    if (match) report(category, source, content, match.index);
  }

  const emailExpression = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi;
  for (const match of content.matchAll(emailExpression)) {
    if (!allowedEmailDomains.has(match[1].toLowerCase())) {
      report("non-example email address", source, content, match.index);
      break;
    }
  }

  const profileExpression = /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|sales\/lead)\/([^\s"'<>),/]+)/gi;
  for (const match of content.matchAll(profileExpression)) {
    if (!allowedProfileSlugs.test(match[1])) {
      report("non-example LinkedIn profile URL", source, content, match.index);
      break;
    }
  }
}

const trackedFiles = git(["ls-files", "-z"]).split("\0").filter(Boolean);
for (const file of trackedFiles) {
  const normalized = file.replaceAll("\\", "/");
  for (const [category, expression] of sensitivePathRules) {
    if (normalized === ".env.example" && category === "environment file") continue;
    if (expression.test(normalized)) violations.push({ category, source: normalized, line: 0 });
  }

  const data = readFileSync(file);
  if (data.includes(0)) continue;
  scanContent(normalized, data.toString("utf8"));
}

if (includeHistory) {
  const history = git(["log", "--all", "-p", "--no-ext-diff", "--text", "--format="]);
  scanContent("reachable Git history", history);
}

if (violations.length > 0) {
  console.error("Repository privacy audit failed:");
  for (const violation of violations) {
    const location = violation.line > 0 ? `${violation.source}:${violation.line}` : violation.source;
    console.error(`- ${violation.category}: ${location}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Repository privacy audit passed (${trackedFiles.length} tracked files${includeHistory ? ", including reachable history" : ""}).`);
}
