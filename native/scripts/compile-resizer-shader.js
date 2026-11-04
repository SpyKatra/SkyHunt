// Compile le shader Vulkan de react-native-vision-camera-resizer (Resizer.comp → Resizer.comp.spv).
//
// Pourquoi : la bibliothèque compte sur la compilation de shaders d'Android Gradle (dossier
// src/main/shaders), qu'AGP 9 (Expo SDK 58) ne fait plus. Sans le fichier .spv, le resizer échoue
// au lancement : « Failed to open Vulkan shader asset shaders/Resizer.comp.spv ».
//
// Lancé par EAS après l'installation des modules (script « eas-build-post-install ») : on prend
// le glslc du NDK Android du serveur et on dépose le résultat dans les assets de la bibliothèque
// (src/main/assets/shaders/), qu'Android Gradle intègre à l'APK.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const lib = path.join(__dirname, '..', 'node_modules', 'react-native-vision-camera-resizer', 'android');
const src = path.join(lib, 'src', 'main', 'shaders', 'Resizer.comp');
const out = path.join(lib, 'src', 'main', 'assets', 'shaders', 'Resizer.comp.spv');

function findGlslc() {
  const host = process.platform === 'win32' ? 'windows-x86_64' : process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64';
  const exe = process.platform === 'win32' ? 'glslc.exe' : 'glslc';
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const ndks = [];
  if (process.env.ANDROID_NDK_HOME) ndks.push(process.env.ANDROID_NDK_HOME);
  if (sdk) {
    const dir = path.join(sdk, 'ndk');
    if (fs.existsSync(dir)) {
      for (const v of fs.readdirSync(dir).sort().reverse()) ndks.push(path.join(dir, v));
    }
    ndks.push(path.join(sdk, 'ndk-bundle'));
  }
  for (const ndk of ndks) {
    const p = path.join(ndk, 'shader-tools', host, exe);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

if (!fs.existsSync(src)) {
  console.error(`[SkyHunt] Shader introuvable : ${src}`);
  process.exit(1);
}
const glslc = findGlslc();
if (!glslc) {
  console.error('[SkyHunt] glslc introuvable (NDK Android absent) : le resizer GPU ne fonctionnera pas.');
  process.exit(process.env.EAS_BUILD ? 1 : 0);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(glslc, ['-O', '--target-env=vulkan1.0', '-o', out, src], { stdio: 'inherit' });
console.log(`[SkyHunt] Shader du resizer compilé avec ${glslc} : ${out} (${fs.statSync(out).size} octets)`);
