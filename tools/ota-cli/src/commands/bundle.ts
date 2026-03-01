/**
 * ota bundle
 * ──────────
 * Builds a React Native JS bundle for Android and/or iOS,
 * then packages the bundle + assets into a ZIP file ready for upload.
 *
 * Options:
 *   --platform   android | ios | both (default: both)
 *   --label      release label, e.g. v1.2.3-hotfix1 (required)
 *   --entry      JS entry file (default: index.js)
 *   --out        output directory (default: ./ota-output, relative to the RN project root)
 *   --dev        include React dev bundle (default: false)
 *   --root       path to the React Native project root (default: two levels up from the CLI tool)
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { createHash } from 'crypto';
import chalk from 'chalk';
import ora from 'ora';

// The CLI lives at tools/ota-cli — the RN project root is two levels up
const DEFAULT_RN_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

export const bundleCommand = new Command('bundle')
  .description('Build and zip a React Native OTA bundle')
  .requiredOption('-l, --label <label>', 'Release label, e.g. v1.2.3-hotfix1')
  .option('-p, --platform <platform>', 'android | ios | both', 'both')
  .option('-e, --entry <file>', 'JS entry file', 'index.js')
  .option('-o, --out <dir>', 'Output directory (relative to RN root)', 'ota-output')
  .option('-r, --root <dir>', 'Path to React Native project root', DEFAULT_RN_ROOT)
  .option('--dev', 'Include React dev warnings (not recommended for releases)', false)
  .action(async (opts) => {
    const { label, platform, entry, out: outDirRel, dev, root: rnRoot } = opts;
    const platforms: Array<'android' | 'ios'> =
      platform === 'both' ? ['android', 'ios'] : [platform as 'android' | 'ios'];

    const absoluteRnRoot = path.resolve(rnRoot);
    const absoluteOut = path.resolve(absoluteRnRoot, outDirRel);
    fs.mkdirSync(absoluteOut, { recursive: true });

    console.log(chalk.bold(`\n📦 OTA Bundle — ${chalk.cyan(label)}`));
    console.log(`   RN Root   : ${absoluteRnRoot}`);
    console.log(`   Platforms : ${platforms.join(', ')}`);
    console.log(`   Entry     : ${entry}`);
    console.log(`   Output    : ${absoluteOut}\n`);

    for (const plt of platforms) {
      await buildPlatform({ platform: plt, label, entry, outDir: absoluteOut, dev, rnRoot: absoluteRnRoot });
    }

    console.log(chalk.green('\n✅ Bundle complete.\n'));
  });

// ─── Build for one platform ───────────────────────────────────────────────────

async function buildPlatform(opts: {
  platform: 'android' | 'ios';
  label: string;
  entry: string;
  outDir: string;
  dev: boolean;
  rnRoot: string;
}) {
  const { platform, label, entry, outDir, dev, rnRoot } = opts;
  const bundleFile = platform === 'android' ? 'index.android.bundle' : 'main.jsbundle';
  const platformDir = path.join(outDir, `${label}-${platform}`);
  const bundleOutput = path.join(platformDir, bundleFile);
  const assetsOutput = path.join(platformDir, 'assets');

  fs.mkdirSync(platformDir, { recursive: true });

  // ── Step 1: react-native bundle ──────────────────────────────────────────
  const spinner = ora(`[${platform}] Bundling JS…`).start();

  // Use the react-native binary from the RN project's node_modules
  const rnBin = path.join(rnRoot, 'node_modules', '.bin', 'react-native');

  try {
    execSync(
      [
        `"${rnBin}" bundle`,
        `--platform ${platform}`,
        `--dev ${dev}`,
        `--entry-file "${path.join(rnRoot, entry)}"`,
        `--bundle-output "${bundleOutput}"`,
        `--assets-dest "${assetsOutput}"`,
        '--reset-cache',
      ].join(' '),
      {
        stdio: 'pipe',
        cwd: rnRoot,  // MUST run from RN project root
      },
    );
    spinner.succeed(`[${platform}] Bundle created: ${bundleFile}`);
  } catch (err: any) {
    spinner.fail(`[${platform}] Bundle failed`);
    const stderr = err.stderr?.toString() ?? '';
    const stdout = err.stdout?.toString() ?? '';
    console.error(stderr || stdout || err.message);
    process.exit(1);
  }

  // ── Step 2: Write metadata.json ───────────────────────────────────────────
  const metadataPath = path.join(platformDir, 'metadata.json');
  fs.writeFileSync(
    metadataPath,
    JSON.stringify({ label, platform, bundleFile, builtAt: new Date().toISOString() }, null, 2),
  );

  // ── Step 3: ZIP ───────────────────────────────────────────────────────────
  const zipPath = path.join(outDir, `${label}-${platform}.zip`);
  const zipSpinner = ora(`[${platform}] Creating ZIP…`).start();
  await zipDirectory(platformDir, zipPath);
  zipSpinner.succeed(`[${platform}] ZIP created`);

  // ── Step 4: Compute hash ──────────────────────────────────────────────────
  const hash = sha256File(zipPath);
  const size = fs.statSync(zipPath).size;

  // Save manifest for publish command
  const manifestPath = path.join(outDir, `${label}-${platform}.manifest.json`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ label, platform, zipPath, hash, size }, null, 2),
  );

  console.log(chalk.gray(`   [${platform}] ZIP: ${zipPath}`));
  console.log(chalk.gray(`   [${platform}] SHA-256: ${hash}`));
  console.log(chalk.gray(`   [${platform}] Size: ${(size / 1024).toFixed(1)} KB`));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function zipDirectory(sourceDir: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

function sha256File(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}
