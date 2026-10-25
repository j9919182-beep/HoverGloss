"use strict";
// Local release preparation only: no Git writes, network requests or publication.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), zlib = require("node:zlib"), cp = require("node:child_process");
const root = path.resolve(__dirname, ".."), verifyOnly = process.argv.includes("--verify-only");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (manifest.version !== pkg.version || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Version metadata mismatch");
const version = manifest.version, dirs = [".github", "docs", "icons", "scripts", "tests", "vendor"];
const allowed = (name) => /\.(?:js|cjs|mjs|html|css|md|json|yaml|yml|txt|png|jpg|jpeg|svg|wasm|bcmap|ttf|pfb|gz)$/.test(name) || /^(?:LICENSE(?:[-_].*)?|\.gitignore|\.gitattributes)$/.test(name);
const files = [];
function collect(relative) {
  const absolute = path.join(root, relative), stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symlink: ${relative}`);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(absolute).sort()) collect(`${relative}/${name}`);
  } else if (allowed(path.basename(relative))) {
    if (/\.(?:onnx|safetensors|pdf|key|pem|crx)$/.test(relative) || /(?:^|\/)\.env(?:\.|$)/.test(relative)) throw new Error(`Private/model asset in source: ${relative}`);
    if (stat.size >= 95 * 1000 * 1000) throw new Error(`Oversized Git asset: ${relative}`);
    files.push(relative.replace(/\\/g, "/"));
  } else throw new Error(`Unclassified release asset: ${relative}`);
}
for (const name of fs.readdirSync(root).sort()) {
  if (dirs.includes(name)) collect(name);
  else if (fs.lstatSync(path.join(root, name)).isFile() && allowed(name)) collect(name);
}
files.sort();
const set = new Set(files), data = new Map(files.map((name) => [name, fs.readFileSync(path.join(root, name))]));
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function requireFile(name) { if (!set.has(name)) throw new Error(`Missing release file: ${name}`); }
for (const name of ["README.md", "README.en.md", "PRIVACY.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "CHANGELOG.md", "docs/INSTALL.md", "docs/RELEASE-CHECKLIST.md", "docs/RELEASE-v0.9.31.md", "docs/images/popup.png", "pnpm-lock.yaml"]) requireFile(name);
for (const name of [manifest.background.service_worker, manifest.options_page, manifest.action.default_popup, manifest.side_panel.default_path,
  ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...(entry.css || [])])]) requireFile(name);
const findings = [];
for (const [name, bytes] of data) {
  if (/\.(?:js|cjs|mjs|json|md|ya?ml|txt)$/.test(name)) {
    const text = bytes.toString("utf8");
    if (/(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text)) findings.push(name);
  }
  if (/\.md$/.test(name) && !name.startsWith("docs/archive/")) {
    for (const match of bytes.toString("utf8").matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split(/[?#]/)[0];
      if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), target));
      if (!set.has(resolved)) throw new Error(`Broken document link: ${name} -> ${resolved}`);
    }
  }
  if (/\.html$/.test(name)) {
    for (const match of bytes.toString("utf8").matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (/^(?:https?:|#)/.test(match[1])) continue;
      requireFile(path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1].split(/[?#]/)[0])));
    }
  }
}
if (findings.length) throw new Error(`Review possible credentials in: ${findings.join(", ")}`);
let git = { available: false };
try {
  const untracked = cp.execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/).filter(Boolean);
  git = { available: true, untrackedCount: untracked.length, note: "Source ZIP includes allowlisted working-tree files regardless of Git staging. Review/stage/commit before pushing." };
} catch { /* An extracted source archive need not contain .git. */ }
const inventory = files.map((name) => ({ path: name, bytes: data.get(name).length, sha256: sha(data.get(name)) }));
const report = { version, sourceFiles: files.length, largestFile: inventory.reduce((a, b) => a.bytes > b.bytes ? a : b),
  checks: { metadata: true, manifestResources: true, currentDocumentLinks: true, archivedDocumentLinks: "historical snapshots excluded", htmlResources: true, commonCredentialPatterns: "no matches; not a full secret audit" }, git,
  publication: "Not performed", realModelAndWebsiteValidation: "See docs/RELEASE-CHECKLIST.md; not inferred from structural checks." };
if (verifyOnly) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
// Standard ZIP with UTF-8 names, fixed timestamps and CRC32; no external tools required.
const table = Uint32Array.from({ length: 256 }, (_, value) => { for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0; });
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0; }
function zip(names, prefix) {
  const chunks = [], central = []; let offset = 0;
  for (const name of names) {
    const raw = data.get(name), body = zlib.deflateRawSync(raw), label = Buffer.from(`${prefix}/${name}`), crc = crc32(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE((2026 - 1980) << 9 | 10 << 5 | 25, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(label.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE((2026 - 1980) << 9 | 10 << 5 | 25, 14); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(label.length, 28); entry.writeUInt32LE(offset, 42);
    chunks.push(local, label, body); central.push(entry, label); offset += local.length + label.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}
const runtime = files.filter((name) => !name.startsWith("tests/") && !name.startsWith(".github/"));
const output = path.join(root, "dist"); fs.mkdirSync(output, { recursive: true });
const names = [`HoverGloss-v${version}-preview.zip`, `HoverGloss-v${version}-source.zip`, `HoverGloss-v${version}-files.json`, "SHA256SUMS.txt", "release-preparation.json"];
for (const name of names) if (fs.existsSync(path.join(output, name))) throw new Error(`Output already exists; refusing overwrite: ${name}`);
const artifacts = [zip(runtime, "HoverGloss"), zip(files, "HoverGloss-source"), Buffer.from(JSON.stringify(inventory, null, 2) + "\n")];
artifacts.forEach((bytes, index) => fs.writeFileSync(path.join(output, names[index]), bytes, { flag: "wx" }));
fs.writeFileSync(path.join(output, names[3]), artifacts.map((bytes, index) => `${sha(bytes)}  ${names[index]}`).join("\n") + "\n", { flag: "wx" });
fs.writeFileSync(path.join(output, names[4]), JSON.stringify({ ...report, runtimeFiles: runtime.length, artifacts: names.slice(0, 4) }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output: "dist/", ...report, runtimeFiles: runtime.length }, null, 2));
