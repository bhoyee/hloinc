'use strict';

/**
 * Virus scanning for uploaded files:
 *   - Cloudmersive's cloud scanner, if CLOUDMERSIVE_API_KEY is set (for shared hosting, where
 *     ClamAV can't load its database within the account's memory limit). Files are scanned in
 *     memory and not kept. Its "advanced" scan also refuses macros, scripts, embedded objects
 *     and files that aren't really what they claim to be;
 *   - clamd (the ClamAV daemon) over its socket, if CLAMD_SOCKET or CLAMD_HOST is set;
 *   - otherwise clamdscan, then clamscan, if installed (cPanel servers usually have
 *     /usr/local/cpanel/3rdparty/bin/clamdscan).
 * The EICAR test file is always caught, so the whole path can be tested.
 *
 * scan(buffer) never throws. It returns { status, engine, detail }:
 *   clean    - the scanner checked it and found nothing
 *   infected - malware found (detail names it); the file must not be kept
 *   error    - no scanner could check it (detail says why); keep it locked
 * Outside production, with no ClamAV installed, a basic built-in check stands in
 * (status "clean", engine "basic"), so the site works on a developer's machine.
 */

const fs = require('fs/promises');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { execFile } = require('child_process');
const config = require('../config');

const TIMEOUT_MS = 60 * 1000;
// clamscan loads the whole virus database on every run, which can take a while.
const CLAMSCAN_TIMEOUT_MS = 3 * 60 * 1000;
const EICAR = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE';
const CANDIDATES = {
  clamdscan: ['/usr/local/cpanel/3rdparty/bin/clamdscan', '/usr/bin/clamdscan', '/usr/local/bin/clamdscan'],
  clamscan: ['/usr/local/cpanel/3rdparty/bin/clamscan', '/usr/bin/clamscan', '/usr/local/bin/clamscan'],
};
// Where clamscan's virus database lives (the first folder that has main.cvd or main.cld).
const DATABASES = ['/usr/local/cpanel/3rdparty/share/clamav', '/var/lib/clamav', '/usr/local/share/clamav'];
// ClamAV's public signing certificate, shipped with the site (see config/clamav-certs/README.md).
const BUNDLED_CERTS = path.join(config.paths.root, 'config', 'clamav-certs');

async function databaseDir() {
  if (config.virusScan.database) return config.virusScan.database;
  for (const dir of DATABASES) {
    for (const f of ['main.cvd', 'main.cld']) {
      try {
        await fs.access(path.join(dir, f));
        return dir;
      } catch {
        // try the next one
      }
    }
  }
  return null;
}

async function executable(file) {
  try {
    await fs.access(file, require('fs').constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The clamd INSTREAM protocol: the file in chunks, then a zero length; clamd answers "stream: OK" or "stream: <name> FOUND". */
function clamd(buffer) {
  const { clamdSocket, clamdHost, clamdPort } = config.virusScan;
  return new Promise((resolve) => {
    const conn = clamdSocket ? net.createConnection(clamdSocket) : net.createConnection(clamdPort, clamdHost);
    let reply = '';
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      conn.destroy();
      resolve({ engine: 'ClamAV (clamd)', ...result });
    };
    conn.setTimeout(TIMEOUT_MS, () => finish({ status: 'error', detail: 'The virus scanner took too long' }));
    conn.on('error', (err) => finish({ status: 'error', detail: `Could not reach the virus scanner (${err.code || err.message})` }));
    conn.on('connect', () => {
      conn.write('zINSTREAM\0');
      for (let i = 0; i < buffer.length; i += 64 * 1024) {
        const chunk = buffer.subarray(i, i + 64 * 1024);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        conn.write(size);
        conn.write(chunk);
      }
      conn.write(Buffer.alloc(4));
    });
    conn.on('data', (d) => {
      reply += d.toString();
    });
    conn.on('close', () => {
      const text = reply.replace(/\0/g, '').trim();
      if (/:\s*OK$/.test(text)) return finish({ status: 'clean', detail: null });
      const found = text.match(/:\s*(.+)\s+FOUND$/);
      if (found) return finish({ status: 'infected', detail: found[1].slice(0, 180) });
      return finish({ status: 'error', detail: `Unexpected scanner reply: ${text.slice(0, 120) || '(none)'}` });
    });
  });
}

/** Cloudmersive advanced scan: viruses, plus anything a resume shouldn't contain. */
async function cloudmersive(buffer) {
  const engine = 'Cloudmersive (cloud)';
  const form = new FormData();
  form.append('inputFile', new Blob([buffer]), 'resume');
  const refuse = Object.fromEntries(
    ['allowExecutables', 'allowInvalidFiles', 'allowScripts', 'allowPasswordProtectedFiles', 'allowMacros', 'allowXmlExternalEntities',
      'allowInsecureDeserialization', 'allowHtml', 'allowUnsafeArchives', 'allowOleEmbeddedObject', 'allowUnwantedAction'].map((h) => [h, 'false'])
  );
  let res;
  try {
    res = await fetch('https://api.cloudmersive.com/virus/scan/file/advanced', {
      method: 'POST',
      headers: { Apikey: config.virusScan.cloudmersiveKey, restrictFileTypes: '.pdf,.docx', ...refuse },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { status: 'error', engine, detail: err.name === 'TimeoutError' ? 'The virus scanner took too long' : 'Could not reach the virus scanner' };
  }
  if (!res.ok) {
    const why = { 401: 'the API key was refused', 403: 'the API key was refused', 413: 'the file is too large for the scanning plan', 429: 'the monthly scan allowance is used up' }[res.status] || `HTTP ${res.status}`;
    console.error(`[virus scan] Cloudmersive: ${why}`);
    return { status: 'error', engine, detail: `The virus scanner could not check it (${why})` };
  }
  const r = await res.json().catch(() => null);
  if (!r || typeof r.CleanResult !== 'boolean') return { status: 'error', engine, detail: 'Unexpected reply from the virus scanner' };
  if (r.CleanResult) return { status: 'clean', engine, detail: null };
  const viruses = (r.FoundViruses || []).map((v) => v.VirusName).filter(Boolean);
  const flags = {
    ContainsExecutable: 'a program', ContainsInvalidFile: 'not a valid file', ContainsScript: 'scripts', ContainsPasswordProtectedFile: 'password protection',
    ContainsRestrictedFileFormat: 'not a PDF or Word file', ContainsMacros: 'macros', ContainsXmlExternalEntities: 'unsafe XML', ContainsInsecureDeserialization: 'unsafe data',
    ContainsHtml: 'web page code', ContainsUnsafeArchive: 'an unsafe archive', ContainsOleEmbeddedObject: 'embedded objects', ContainsUnwantedAction: 'unwanted actions',
  };
  const reasons = Object.entries(flags).filter(([k]) => r[k]).map(([, v]) => v);
  return { status: 'infected', engine, detail: (viruses.length ? viruses.join(', ') : `Unsafe content: ${reasons.join(', ') || 'flagged'}`).slice(0, 180) };
}

/** clamdscan / clamscan on a private temporary copy (deleted straight after). Exit code 0 clean, 1 found, 2 error. */
async function commandLine(binary, name, buffer) {
  const dir = path.join(config.paths.storage, 'tmp');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `scan-${crypto.randomBytes(12).toString('hex')}`);
  await fs.writeFile(file, buffer, { mode: 0o600 });
  // clamdscan --stream sends the file's contents to the daemon, so the daemon needn't be able to read our folder.
  let args = ['--stream', '--no-summary', file];
  let options = { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 };
  if (name === 'clamscan') {
    // Tell clamscan where its database and certificates are, rather than relying on its own settings.
    const certs = config.virusScan.certsDir || BUNDLED_CERTS;
    const db = await databaseDir();
    args = ['--no-summary', `--cvdcertsdir=${certs}`, ...(db ? [`--database=${db}`] : []), file];
    options = { ...options, timeout: CLAMSCAN_TIMEOUT_MS, env: { ...process.env, CVD_CERTS_DIR: certs } };
  }
  try {
    return await new Promise((resolve) => {
      execFile(binary, args, options, (err, stdout, stderr) => {
        const engine = `ClamAV (${name})`;
        const code = err ? err.code : 0;
        if (code === 0) return resolve({ status: 'clean', engine, detail: null });
        const found = String(stdout).match(/:\s*(.+)\s+FOUND/);
        if (code === 1 && found) return resolve({ status: 'infected', engine, detail: found[1].slice(0, 180) });
        if (!(err && err.killed)) console.error(`[virus scan] ${name} failed (${code}): ${String(stderr || stdout).trim().slice(0, 300)}`);
        resolve({ status: 'error', engine, detail: err && err.killed ? 'The virus scanner took too long' : `The virus scanner could not run (${String(code)})` });
      });
    });
  } finally {
    await fs.rm(file, { force: true });
  }
}

/** Which scanner to use, in order of preference. */
async function engine() {
  const { mode, clamdSocket, clamdHost, clamscanPath } = config.virusScan;
  if (mode === 'basic') return config.isProd ? null : { name: 'basic' };
  if ((mode === 'auto' || mode === 'cloudmersive') && config.virusScan.cloudmersiveKey) return { name: 'cloudmersive' };
  if (mode === 'cloudmersive') return null;
  if ((mode === 'auto' || mode === 'clamd') && (clamdSocket || clamdHost)) return { name: 'clamd' };
  for (const name of ['clamdscan', 'clamscan']) {
    if (mode !== 'auto' && mode !== name) continue;
    const list = clamscanPath && (mode === name || clamscanPath.endsWith(name)) ? [clamscanPath] : CANDIDATES[name];
    for (const file of list) if (await executable(file)) return { name, file };
  }
  return config.isProd ? null : { name: 'basic' };
}

async function scan(buffer) {
  if (buffer.includes(EICAR)) return { status: 'infected', engine: 'built-in check', detail: 'Eicar-Test-Signature' };
  const e = await engine();
  if (!e) return { status: 'error', engine: null, detail: 'No virus scanner is installed on the server' };
  if (e.name === 'basic') return { status: 'clean', engine: 'basic (development only)', detail: null };
  if (e.name === 'clamd') return clamd(buffer);
  if (e.name === 'cloudmersive') return cloudmersive(buffer);
  const result = await commandLine(e.file, e.name, buffer);
  // clamdscan needs the ClamAV service running; if it isn't, clamscan works on its own (slower).
  if (result.status === 'error' && e.name === 'clamdscan' && config.virusScan.mode === 'auto') {
    for (const file of CANDIDATES.clamscan) if (await executable(file)) return commandLine(file, 'clamscan', buffer);
  }
  return result;
}

/** For the portal: which scanner is in use, if any. */
async function describe() {
  const e = await engine();
  if (!e) return { ok: false, label: 'No virus scanner found' };
  if (e.name === 'basic') return { ok: !config.isProd, label: 'Basic checks only (development)' };
  return { ok: true, label: { clamd: 'ClamAV daemon', cloudmersive: 'Cloudmersive (cloud)' }[e.name] || `ClamAV (${e.name})` };
}

module.exports = { scan, describe, EICAR };
