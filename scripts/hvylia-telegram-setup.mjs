import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { telegramCall } from '../api/hvylia-telegram.js';

const project = resolve(import.meta.dirname, '..');
const localPath = resolve(project, '.hvylia-bot.local.json');

async function run(args, input) {
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { cwd: project, windowsHide: true, stdio: ['pipe', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error('Налаштування Cloudflare не завершилося. Перевірте авторизацію і повторіть запуск.')));
    child.stdin.end(input);
  });
}

try {
  let local;
  try { local = JSON.parse(await readFile(localPath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Не вдалося прочитати .hvylia-bot.local.json. Перевірте, що це коректний JSON.');
    await writeFile(localPath, `${JSON.stringify({ botToken: '', paymentSupport: '', webhookSecret: '', adminToken: '' }, null, 2)}\n`, { flag: 'wx' });
    throw new Error('Створено .hvylia-bot.local.json. Впишіть токен нового бота і контакт підтримки, потім повторіть запуск. Цей файл не потрапляє в Git.');
  }
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/u.test(local.botToken || '')) throw new Error('Заповніть botToken у .hvylia-bot.local.json токеном від BotFather.');
  if (typeof local.paymentSupport !== 'string' || local.paymentSupport.trim().length < 3 || local.paymentSupport.length > 200) throw new Error('Заповніть paymentSupport: ваш контакт для питань щодо оплат, наприклад @username.');
  const env = { HVYLIA_BOT_TOKEN: local.botToken };
  const bot = await telegramCall(env, 'getMe', {});
  if (!bot?.is_bot || !/^[A-Za-z0-9_]{5,32}$/u.test(bot.username || '')) throw new Error('Telegram не підтвердив цього бота. Перевірте токен.');
  local.webhookSecret ||= randomBytes(32).toString('hex');
  local.adminToken ||= randomBytes(32).toString('hex');
  if (!/^[A-Za-z0-9_-]{32,256}$/u.test(local.webhookSecret) || !/^[A-Za-z0-9_-]{32,256}$/u.test(local.adminToken)) throw new Error('Залиште webhookSecret/adminToken порожніми для автоматичної генерації або вкажіть довгі випадкові значення.');
  await writeFile(localPath, `${JSON.stringify(local, null, 2)}\n`);
  const configPath = resolve(project, 'wrangler.hvylia.jsonc');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.vars.HVYLIA_BOT_USERNAME = bot.username;
  config.vars.HVYLIA_PAYMENT_SUPPORT = local.paymentSupport.trim();
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const wrangler = resolve(project, 'node_modules/wrangler/bin/wrangler.js');
  await run([wrangler, 'secret', 'bulk', '--config', 'wrangler.hvylia.jsonc'], JSON.stringify({
    HVYLIA_BOT_TOKEN: local.botToken,
    HVYLIA_WEBHOOK_SECRET: local.webhookSecret,
    HVYLIA_ADMIN_TOKEN: local.adminToken
  }));
  await run([resolve(project, 'scripts/hvylia-build.mjs')]);
  await run([wrangler, 'deploy', '--config', 'wrangler.hvylia.jsonc']);
  const appUrl = `${config.vars.SITE_ORIGIN}/hvylia/`;
  const workerUrl = 'https://dovzhyna-hvyli.lordskamp.workers.dev';
  await telegramCall(env, 'setWebhook', {
    url: `${workerUrl}/api/hvylia/telegram-webhook`, secret_token: local.webhookSecret,
    allowed_updates: ['message', 'pre_checkout_query']
  });
  await telegramCall(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Грати', web_app: { url: appUrl } } });
  await telegramCall(env, 'setMyCommands', { commands: [
    { command: 'start', description: 'Почати гру' },
    { command: 'help', description: 'Як відкрити гру' },
    { command: 'paysupport', description: 'Допомога з оплатою Stars' }
  ] });
  const webhook = await telegramCall(env, 'getWebhookInfo', {});
  if (webhook.url !== `${workerUrl}/api/hvylia/telegram-webhook`) throw new Error('Адреса Telegram webhook не збігається. Повторіть налаштування.');
  console.log(`Бот @${bot.username} підключений. У BotFather увімкніть Main Mini App з адресою ${appUrl}, щоб працювали прямі запрошення до кімнат.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
