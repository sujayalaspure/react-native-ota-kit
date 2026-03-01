/**
 * ota publish
 * ───────────
 * Uploads a built OTA bundle ZIP to the OTA server.
 *
 * Reads config from ota.config.json (or --config flag) plus
 * the manifest JSON written by `ota bundle`.
 *
 * Options:
 *   --label      release label (matches what was passed to `ota bundle`)
 *   --platform   android | ios | both (default: both)
 *   --config     path to ota.config.json (default: ./ota.config.json)
 *   --mandatory  mark this release as mandatory
 */

import { Command } from 'commander';
import path from 'path';
import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';
import chalk from 'chalk';
import ora from 'ora';

interface OtaConfig {
  serverUrl: string;
  secret: string;
  channel: string;
  appVersion: string;
}

interface BundleManifest {
  label: string;
  platform: 'android' | 'ios';
  zipPath: string;
  hash: string;
  size: number;
}

export const publishCommand = new Command('publish')
  .description('Upload an OTA bundle to the update server')
  .requiredOption('-l, --label <label>', 'Release label (must match what was built)')
  .option('-p, --platform <platform>', 'android | ios | both', 'both')
  .option('-c, --config <path>', 'Path to ota.config.json', path.resolve(__dirname, '..', '..', '..', '..', 'ota.config.json'))
  .option('-o, --out <dir>', 'Build output directory (must match ota bundle --out, relative to RN root)', 'ota-output')
  .option('--root <dir>', 'Path to React Native project root', path.resolve(__dirname, '..', '..', '..', '..'))
  .option('--mandatory', 'Mark this release as mandatory', false)
  .action(async (opts) => {
    const { label, platform, config: configPath, out: outDirRel, root: rnRoot, mandatory } = opts;
    const platforms: Array<'android' | 'ios'> =
      platform === 'both' ? ['android', 'ios'] : [platform as 'android' | 'ios'];
    const outDir = path.resolve(rnRoot, outDirRel);

    // ── Load config ──────────────────────────────────────────────────────────
    const absConfig = path.resolve(configPath);
    if (!fs.existsSync(absConfig)) {
      console.error(chalk.red(`❌ Config not found: ${absConfig}`));
      console.error(chalk.gray('   Create ota.config.json or use --config to specify a path.'));
      process.exit(1);
    }
    const cfg: OtaConfig = JSON.parse(fs.readFileSync(absConfig, 'utf8'));

    console.log(chalk.bold(`\n🚀 OTA Publish — ${chalk.cyan(label)}`));
    console.log(`   Server  : ${cfg.serverUrl}`);
    console.log(`   Channel : ${cfg.channel}`);
    console.log(`   Platforms: ${platforms.join(', ')}\n`);

    for (const plt of platforms) {
      await uploadPlatform({ cfg, label, platform: plt, outDir, mandatory });
    }

    console.log(chalk.green('\n✅ Publish complete.\n'));
  });

// ─── Upload one platform ──────────────────────────────────────────────────────

async function uploadPlatform(opts: {
  cfg: OtaConfig;
  label: string;
  platform: 'android' | 'ios';
  outDir: string;
  mandatory: boolean;
}) {
  const { cfg, label, platform, outDir, mandatory } = opts;
  const absOut = path.resolve(outDir);
  const manifestPath = path.join(absOut, `${label}-${platform}.manifest.json`);

  if (!fs.existsSync(manifestPath)) {
    console.error(chalk.red(`❌ Manifest not found: ${manifestPath}`));
    console.error(chalk.gray('   Run `ota bundle` first.'));
    process.exit(1);
  }

  const manifest: BundleManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const spinner = ora(`[${platform}] Uploading ${(manifest.size / 1024).toFixed(1)} KB…`).start();

  const form = new FormData();
  form.append('bundle', fs.createReadStream(manifest.zipPath), {
    filename: path.basename(manifest.zipPath),
    contentType: 'application/zip',
  });
  form.append('label', label);
  form.append('appVersion', cfg.appVersion);
  form.append('channel', cfg.channel);
  form.append('platform', platform);
  form.append('mandatory', String(mandatory));
  form.append('hash', manifest.hash);

  try {
    const resp = await fetch(`${cfg.serverUrl}/v1/releases`, {
      method: 'POST',
      headers: {
        'x-ota-secret': cfg.secret,
        ...form.getHeaders(),
      },
      body: form,
    });

    const body = await resp.json() as any;

    if (!resp.ok) {
      spinner.fail(`[${platform}] Upload failed: ${body.error ?? resp.status}`);
      process.exit(1);
    }

    spinner.succeed(`[${platform}] Published — id: ${body.release.id}`);
    console.log(chalk.gray(`   Hash: ${manifest.hash}`));
  } catch (err: any) {
    spinner.fail(`[${platform}] Network error: ${err.message}`);
    process.exit(1);
  }
}
