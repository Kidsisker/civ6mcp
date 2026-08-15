import { homedir, platform } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

function getWindowsLocalAppDataDirectory(): string {
  return process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
}

let cachedWindowsDocumentsDirectory: string | undefined;

/**
 * Resolve the user's actual Documents folder on Windows. Folder redirection
 * (e.g. OneDrive) can move it away from %USERPROFILE%\Documents, so read the
 * "Personal" shell folder from the registry and fall back to the default.
 */
function getWindowsDocumentsDirectory(): string {
  if (cachedWindowsDocumentsDirectory) {
    return cachedWindowsDocumentsDirectory;
  }
  let documents = join(homedir(), 'Documents');
  try {
    const output = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Personal'],
      { encoding: 'utf8', windowsHide: true }
    );
    const match = output.match(/Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)/);
    if (match) {
      documents = match[1].trim().replace(/%([^%]+)%/g, (m, name) => process.env[name] ?? m);
    }
  } catch {
    // reg.exe unavailable or key missing — keep the default.
  }
  cachedWindowsDocumentsDirectory = documents;
  return documents;
}

/**
 * Get the Civilization VI saves directory for the current platform.
 */
export function getSavesDirectory(): string {
  if (platform() === 'win32') {
    return join(getWindowsDocumentsDirectory(), 'My Games', "Sid Meier's Civilization VI", 'Saves');
  }
  // macOS
  return join(homedir(), 'Library', 'Application Support', "Sid Meier's Civilization VI", "Sid Meier's Civilization VI", 'Saves');
}

/**
 * Get the Civilization VI logs directory for the current platform.
 */
export function getLogsDirectory(): string {
  if (platform() === 'win32') {
    return join(getWindowsLocalAppDataDirectory(), 'Firaxis Games', "Sid Meier's Civilization VI", 'Logs');
  }
  // macOS
  return join(homedir(), 'Library', 'Application Support', "Sid Meier's Civilization VI", 'Firaxis Games', "Sid Meier's Civilization VI", 'Logs');
}

/**
 * Get the UserOptions.txt path for the current platform (for documentation purposes).
 */
export function getUserOptionsPath(): string {
  if (platform() === 'win32') {
    return join(getWindowsLocalAppDataDirectory(), 'Firaxis Games', "Sid Meier's Civilization VI", 'UserOptions.txt');
  }
  // macOS
  return join(homedir(), 'Library', 'Application Support', "Sid Meier's Civilization VI", 'UserOptions.txt');
}
