// Build the Windows app: web build -> ./game (+ high-res models) -> Electron package -> optional NSIS installer -> local install + shortcuts.
//   node build.mjs [--installer] [--no-install]
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { packager } from '@electron/packager';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const WEB = path.resolve(HERE, '..');
const GAME = path.join(HERE, 'game');
const HQ = path.join(WEB, 'assetgen', 'out', 'models_hq');
const HQ2D = path.join(WEB, 'assetgen', 'out', 'hq');
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

run('npx vite build', WEB);
fs.rmSync(GAME, { recursive: true, force: true });
fs.cpSync(path.join(WEB, 'dist'), GAME, { recursive: true });
// desktop gets the 2K-texture models the web build leaves out
if (fs.existsSync(HQ)) for (const f of fs.readdirSync(HQ)) if (f.endsWith('.glb')) fs.copyFileSync(path.join(HQ, f), path.join(GAME, 'models', f));
// ...and full-resolution key art, skies and textures
if (fs.existsSync(HQ2D)) fs.cpSync(HQ2D, GAME, { recursive: true });

const [appDir] = await packager({
  dir: HERE, out: path.join(HERE, 'out'), overwrite: true, platform: 'win32', arch: 'x64',
  name: 'ZenithUmbra', executableName: 'ZenithUmbra', icon: path.join(HERE, 'icon.ico'), asar: true,
  ignore: [/^\/out($|\/)/, /^\/build\.mjs$/, /^\/make-icon\.py$/],
  appCopyright: 'EveraldTah', win32metadata: { CompanyName: 'EveraldTah', FileDescription: 'ZENITH//UMBRA', ProductName: 'ZENITH//UMBRA' },
});
console.log('packaged:', appDir);

if (process.argv.includes('--installer')) {
  const { build: ebuild, Platform, Arch } = await import('electron-builder');
  const files = await ebuild({
    targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), prepackaged: appDir,
    config: {
      appId: 'com.everaldtah.zenithumbra', productName: 'ZENITH UMBRA', directories: { output: path.join(HERE, 'out', 'installer') },
      win: { icon: path.join(HERE, 'icon.ico'), signAndEditExecutable: false },
      nsis: {
        oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true,
        shortcutName: 'ZENITH UMBRA', artifactName: 'ZenithUmbra-Setup.exe',
        installerIcon: path.join(HERE, 'icon.ico'), uninstallerIcon: path.join(HERE, 'icon.ico'), runAfterFinish: true,
      },
    },
  });
  console.log('installer:', files.filter(f => f.endsWith('.exe')).join(', '));
}

if (!process.argv.includes('--no-install')) {
  const dest = path.join(process.env.LOCALAPPDATA, 'Programs', 'ZenithUmbra');
  try { execSync('taskkill /IM ZenithUmbra.exe /F', { stdio: 'ignore' }); } catch { /* not running */ }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(appDir, dest, { recursive: true });
  const exe = path.join(dest, 'ZenithUmbra.exe');
  const ps1 = path.join(HERE, 'out', 'shortcuts.ps1');
  fs.writeFileSync(ps1, [
    '$s = New-Object -ComObject WScript.Shell',
    ...['Desktop', 'Programs'].map(folder => [
      `$l = $s.CreateShortcut((Join-Path ([Environment]::GetFolderPath('${folder}')) 'ZENITH UMBRA.lnk'))`,
      `$l.TargetPath = '${exe}'`, `$l.WorkingDirectory = '${dest}'`, `$l.IconLocation = '${exe},0'`,
      `$l.Description = 'ZENITH//UMBRA - anime hero shooter'`, '$l.Save()',
    ].join('\n')),
  ].join('\n'), 'utf8');
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, { stdio: 'inherit' });
  console.log('installed:', exe);
}
