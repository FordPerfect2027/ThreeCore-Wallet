/** Explicit Windows x64 file privacy checks. No filesystem/process work on import. */
import { lstatSync, realpathSync } from "node:fs";
import { win32 } from "node:path";
import { spawnSync } from "node:child_process";

const errorCodes = new WeakMap();
function fail(code) {
  const error = new Error(code);
  errorCodes.set(error, code);
  throw error;
}
export const windowsJournalPrivacyErrorCode = error => errorCodes.get(error);
export const windowsJournalPrivacySupported = () => process.platform === "win32" && process.arch === "x64";

const SUFFIXES = ["", "-journal", "-wal", "-shm"];
const FILE_LIMIT = 4n * 1024n * 1024n, SIDECAR_LIMIT = 8n * 1024n * 1024n;
const RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3]|CONIN\$|CONOUT\$|CLOCK\$)(?:\.|$)/i;
function canonicalPath(value) {
  return typeof value === "string" && value.length <= 240 && /^[A-Za-z]:\\/.test(value) &&
    win32.resolve(value) === value && win32.normalize(value) === value &&
    !/[\uD800-\uDFFF]/u.test(value) && value.slice(3).split("\\").every(part =>
      part.length > 0 && !/[<>:"/|?*\x00-\x1f]/.test(part) && !/[. ]$/.test(part) && !RESERVED_NAME.test(part));
}

function positiveIdentity(stat) {
  return typeof stat.dev === "bigint" && typeof stat.ino === "bigint" && stat.dev > 0n && stat.ino > 0n;
}
function snapshot(filename, requireFile) {
  const directory = win32.dirname(filename);
  const parent = lstatSync(directory, { bigint: true });
  if (!parent.isDirectory() || parent.isSymbolicLink() || !positiveIdentity(parent) ||
      realpathSync.native(directory) !== directory) fail("JOURNAL_DIRECTORY_NOT_PRIVATE");
  let presentMask = 0;
  const files = SUFFIXES.map((suffix, index) => {
    const pathname = filename + suffix;
    let stat;
    try { stat = lstatSync(pathname, { bigint: true }); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || !positiveIdentity(stat) || stat.nlink !== 1n ||
        stat.size > (index === 0 ? FILE_LIMIT : SIDECAR_LIMIT) || realpathSync.native(pathname) !== pathname) fail("INVALID_JOURNAL_FILE");
    presentMask |= 1 << index;
    return { dev: stat.dev, ino: stat.ino };
  });
  // Do not attach an orphan rollback/WAL file to an explicitly created journal.
  if (!files[0] && presentMask !== 0) fail("INVALID_JOURNAL_FILE");
  if (requireFile && !files[0]) fail("JOURNAL_UNAVAILABLE");
  return { directoryDev: parent.dev, directoryIno: parent.ino, presentMask, files };
}
function verifiedAuxiliaries(before, after, presentMask) {
  return after.files.every((file, index) => index === 0 || file === null ||
    ((presentMask & (1 << index)) !== 0 && file.dev === before.files[index]?.dev && file.ino === before.files[index]?.ino));
}
function sameAnchor(left, right) {
  const main = left.files[0], current = right.files[0];
  return left.directoryDev === right.directoryDev && left.directoryIno === right.directoryIno &&
    (main === null ? current === null : main.dev === current?.dev && main.ino === current?.ino);
}

// This script is constant: filenames are UTF-8 stdin data, never PowerShell code.
// Only current owner, SYSTEM and Administrators are trusted; this deliberately
// does not attempt a general Windows effective-permission evaluator.
const INSPECTOR = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$PSModuleAutoLoadingPreference='None'
function Refuse([string]$code) {
  [Console]::Out.Write('{"version":1,"ok":false,"code":"'+$code+'"}')
  exit 2
}
function PrivateAcl($item, [bool]$directory, [string]$current) {
  $sections=[Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner
  $acl=$item.GetAccessControl($sections)
  $raw=[Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(),0)
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $current) { return $false }
  if (($raw.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclPresent) -eq 0) { return $false }
  if ($null -eq $raw.DiscretionaryAcl -or $raw.DiscretionaryAcl.Count -lt 1 -or $raw.DiscretionaryAcl.Count -gt 8) { return $false }
  if ($directory -and -not $acl.AreAccessRulesProtected) { return $false }
  if (-not $acl.AreAccessRulesCanonical) { return $false }
  $hasOwner=$false
  foreach ($ace in $raw.DiscretionaryAcl) {
    if (-not ($ace -is [Security.AccessControl.CommonAce]) -or $ace.AceType -ne [Security.AccessControl.AceType]::AccessAllowed -or $ace.IsCallback -or $ace.OpaqueLength -ne 0) { return $false }
    $sid=$ace.SecurityIdentifier.Value
    if ($sid -ne $current -and $sid -ne 'S-1-5-18' -and $sid -ne 'S-1-5-32-544') { return $false }
    if ($ace.AccessMask -ne [int][Security.AccessControl.FileSystemRights]::FullControl) { return $false }
    $flags=[int]$ace.AceFlags
    if ($directory) {
      if ($flags -ne 3) { return $false }
    } elseif ($flags -ne 0 -and $flags -ne 16) { return $false }
    if ($sid -eq $current) { $hasOwner=$true }
  }
  return $hasOwner
}
try {
  [Console]::InputEncoding=[Text.UTF8Encoding]::new($false,$true)
  [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false,$true)
  if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or -not [Environment]::Is64BitProcess) { Refuse 'JOURNAL_UNAVAILABLE' }
  $filename=[Console]::In.ReadToEnd()
  $parent=[IO.DirectoryInfo]::new([IO.Path]::GetDirectoryName($filename))
  $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($filename))
  if ($drive.DriveType -ne [IO.DriveType]::Fixed -or $drive.DriveFormat -ne 'NTFS') { Refuse 'INVALID_JOURNAL_PATH' }
  $ancestor=$parent
  while ($null -ne $ancestor) {
    $attributes=$ancestor.Attributes
    if (-not $ancestor.Exists -or ($attributes -band [IO.FileAttributes]::Directory) -eq 0 -or ($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Refuse 'JOURNAL_DIRECTORY_NOT_PRIVATE' }
    $ancestor=$ancestor.Parent
  }
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  $current=$identity.User.Value
  $identity.Dispose()
  if (-not (PrivateAcl $parent $true $current)) { Refuse 'JOURNAL_DIRECTORY_NOT_PRIVATE' }
  $suffixes=@('','-journal','-wal','-shm')
  $presentMask=0
  for ($index=0; $index -lt $suffixes.Length; $index++) {
    $file=[IO.FileInfo]::new($filename+$suffixes[$index])
    if ($file.Exists) {
      if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or -not (PrivateAcl $file $false $current)) { Refuse 'INVALID_JOURNAL_FILE' }
      $presentMask=$presentMask -bor (1 -shl $index)
    }
  }
  [Console]::Out.Write('{"version":1,"ok":true,"presentMask":'+$presentMask.ToString([Globalization.CultureInfo]::InvariantCulture)+'}')
} catch {
  [Console]::Out.Write('{"version":1,"ok":false,"code":"JOURNAL_UNAVAILABLE"}')
  exit 2
}
`;
const ENCODED_INSPECTOR = Buffer.from(INSPECTOR, "utf16le").toString("base64");

function inspect(filename) {
  // SystemRoot is trusted operator/OS configuration, not a caller-supplied
  // executable. Never search PATH or fall back to another shell/interpreter.
  const systemRoot = process.env.SystemRoot;
  if (!canonicalPath(systemRoot)) fail("JOURNAL_UNAVAILABLE");
  const canonicalRoot = realpathSync.native(systemRoot);
  if (canonicalRoot.toLowerCase() !== systemRoot.toLowerCase()) fail("JOURNAL_UNAVAILABLE");
  const configuredExecutable = win32.join(canonicalRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const executable = realpathSync.native(configuredExecutable);
  const root = lstatSync(systemRoot), program = lstatSync(configuredExecutable);
  // Windows commonly supplies different casing for these installed OS paths.
  // Accept only case differences, then use the native canonical spellings.
  if (!root.isDirectory() || root.isSymbolicLink() || executable.toLowerCase() !== configuredExecutable.toLowerCase() ||
      !program.isFile() || program.isSymbolicLink()) fail("JOURNAL_UNAVAILABLE");
  const result = spawnSync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", ENCODED_INSPECTOR], {
    input: filename, encoding: "utf8", env: { SystemRoot: canonicalRoot }, cwd: win32.dirname(executable),
    windowsHide: true, shell: false, timeout: 5000, maxBuffer: 4096,
  });
  if (result.error || result.signal || result.stderr !== "" || typeof result.stdout !== "string") fail("JOURNAL_UNAVAILABLE");
  const accepted = /^\{"version":1,"ok":true,"presentMask":([0-9]|1[0-5])\}$/.exec(result.stdout);
  if (result.status === 0 && accepted) return Number(accepted[1]);
  const refused = /^\{"version":1,"ok":false,"code":"(INVALID_JOURNAL_PATH|JOURNAL_DIRECTORY_NOT_PRIVATE|INVALID_JOURNAL_FILE|JOURNAL_UNAVAILABLE)"\}$/.exec(result.stdout);
  if (result.status === 2 && refused) fail(refused[1]);
  fail("JOURNAL_UNAVAILABLE");
}

/** Batch parent + journal + present SQLite sidecars in one bounded subprocess. */
export function verifyWindowsJournalPrivacy(filename, requireFile) {
  try {
    if (!windowsJournalPrivacySupported()) fail("JOURNAL_PLATFORM_UNVERIFIED");
    if (!canonicalPath(filename) || !filename.endsWith(".sqlite")) fail("INVALID_JOURNAL_PATH");
    const anchor = snapshot(filename, requireFile);
    for (let inspection = 0; inspection < 2; inspection++) {
      const before = inspection === 0 ? anchor : snapshot(filename, requireFile);
      if (!sameAnchor(anchor, before)) fail("JOURNAL_FILE_CHANGED");
      const presentMask = inspect(filename);
      if ((presentMask & 1) !== (anchor.presentMask & 1)) fail("JOURNAL_FILE_CHANGED");
      const after = snapshot(filename, requireFile);
      if (!sameAnchor(anchor, after)) fail("JOURNAL_FILE_CHANGED");
      if (verifiedAuxiliaries(before, after, presentMask)) {
        return Object.freeze({ dev: after.files[0]?.dev, ino: after.files[0]?.ino,
          directoryDev: after.directoryDev, directoryIno: after.directoryIno });
      }
      // A concurrent SQLite writer can create/remove a private rollback file.
      // Reinspect auxiliary churn once, entirely before SQL. Every remaining
      // file needs inspected identity continuity. A final definite ENOENT
      // leaves no sidecar to open; it does not prove the removed file's ACL.
      // Main/parent changes and all inspection errors remain terminal.
      // This never retries a transaction or reservation.
    }
    fail("JOURNAL_FILE_CHANGED");
  } catch (error) {
    if (errorCodes.has(error)) throw error;
    fail("JOURNAL_UNAVAILABLE");
  }
}
