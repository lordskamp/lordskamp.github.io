# Шифр: запуск і наповнення

Фінальна адреса гри: `https://lordskamp.github.io/shyfr/`.

## Архітектура

- `shyfr/` — статичний mobile-first клієнт на GitHub Pages; правильні відповіді до початку гри не надсилаються.
- `api/shyfr-api.js` — маршрути `/shyfr`, Telegram-авторизація, спроби, прогрес, лідерборд і Telegram Stars.
- `api/shyfr-core.js` — шифрування, залежна від номера рівня складність і закриті символи.
- `content/shyfr/categories.json` — єдине джерело назв, кольорів і налаштувань категорій.
- `content/shyfr/<category>.json` — публічні рівні; у записі лише `text` і `source`.
- Worker читає ці JSON безпосередньо з GitHub Pages і кешує їх на 60 секунд. Згенерованої копії каталогу немає.
- `KOBZA_LEADERBOARD` — Cloudflare KV лише для користувачів, прогресу, спроб, покупок і приватних платних рівнів.

KV має eventual consistency і не підтримує транзакцій між кількома ключами. Обробка одного Telegram charge ідемпотентна завдяки `processedCharges` в одному записі користувача, але для великого платіжного навантаження варто окремо перейти на Durable Object. Для поточного масштабу GitHub Pages + Worker + KV цього достатньо.

## Додавання рівнів

Відкрийте файл категорії, наприклад `content/shyfr/poetry.json`, і додайте запис до масиву:

```json
{ "text": "Текст нового рівня", "source": "Автор або назва джерела | https://example.com/source" }
```

Це всі дозволені поля. Посилання після ` | ` необов’язкове; назва джерела обов’язкова. ID і порядковий номер створюються автоматично. Відсоток прихованих комірок зростає від 60% на першому пройденому рівні до максимуму 98%. Звичайні замки з’являються після 10 завершених рівнів, подвійні — після 20. Рівні категорії проходяться лише послідовно.

Життя щодня поновлюються до 4, підказки — щонайменше до 3, о 00:00 за київським часом. Купівля життів повністю заповнює денний запас, а куплені підказки додаються понад денний ліміт.

## Перший запуск і профіль

- Перший запуск починається з обов’язкового навчання з трьох рівнів: звичайного, з одинарними та з подвійними замками. До його завершення меню категорій закрите.
- У навчанні підказки не списуються з основного запасу, проте доступні загалом тричі; здатися в ньому не можна.
- Після навчання гравець у браузері вводить нікнейм. Лише після цього його результат потрапляє до лідерборда.
- У Telegram ім’я та аватар беруться з підписаних `initData`. Аватар відображається у профілі та в лідерборді. Звичайна вебверсія продовжує працювати без Telegram.

Перевірка перед публікацією:

```powershell
pnpm run validate:shyfr-content
pnpm run check:shyfr-duplicates
```

Після публікації зміненого JSON через GitHub Pages Worker підхопить його автоматично — зазвичай протягом 60 секунд. Повторно розгортати Worker для додавання публічних рівнів або категорій не потрібно.

## Приватні платні рівні у KV

Платні тексти не кладіть у публічний GitHub-репозиторій. Створіть поза ним директорію з такими самими файлами `<category>.json`, згенеруйте KV bulk-файл і завантажте його в наявний namespace:

```powershell
$env:SHYFR_PRIVATE_CONTENT_ROOT = 'D:\private\shyfr-content'
$env:SHYFR_PRIVATE_KV_OUTPUT = 'D:\private\shyfr-content\kv-bulk.json'
pnpm run build:shyfr-private-kv
pnpm exec wrangler kv bulk put $env:SHYFR_PRIVATE_KV_OUTPUT --binding KOBZA_LEADERBOARD --remote
Remove-Item -LiteralPath $env:SHYFR_PRIVATE_KV_OUTPUT
```

Worker читає з ключа `shyfr:content:catalog` лише приватні платні рівні. Назви категорій і публічний контент у KV не дублюються. Публічний валідатор не дозволяє випадково опублікувати платний текст.

## Cloudflare Worker

1. Скопіюйте `wrangler.example.toml` до ігнорованого `wrangler.toml` і вкажіть ID наявного `KOBZA_LEADERBOARD`.
2. Задайте секрети, не вставляючи їх у файли:

```powershell
pnpm exec wrangler secret put SHYFR_BOT_TOKEN
pnpm exec wrangler secret put SHYFR_WEBHOOK_SECRET
pnpm exec wrangler secret put SHYFR_ADMIN_TOKEN
```

3. Налаштуйте variables із `.env.example`, перевірте `SHYFR_MINI_APP_URL` і `SHYFR_CONTENT_BASE_URL`, потім розгорніть Worker звичним для цього сайту способом.

Локально сторінку можна відкрити за адресою `http://127.0.0.1:8080/shyfr/?api=http://127.0.0.1:8787/shyfr` після запуску статичного сервера і Worker.

## Telegram і Stars

1. У BotFather створіть або виберіть бота та згенеруйте новий token.
2. Збережіть token лише в `SHYFR_BOT_TOKEN` як Worker secret.
3. У BotFather задайте Mini App URL `https://lordskamp.github.io/shyfr/`.
4. Створіть випадковий `SHYFR_WEBHOOK_SECRET` із символів `A-Z`, `a-z`, `0-9`, `_`, `-`.
5. Встановіть webhook на `https://kobza-leaderboard.lordskamp.workers.dev/shyfr/telegram-webhook` з цим secret у `secret_token`.
6. Вкажіть справжній `SHYFR_PAYMENT_SUPPORT`, бо Telegram надсилає команду `/paysupport` у разі питань щодо Stars.

Ціни визначає тільки Worker. Клієнт надсилає `productKey`, а Worker сам знаходить товар, ціну й валюту `XTR`. Повернення оплати виконує адміністратор через `POST /shyfr/admin/refund` з `Authorization: Bearer <SHYFR_ADMIN_TOKEN>` і JSON `{ "purchaseId": "..." }`.

## Перед публікацією

```powershell
pnpm run build
pnpm run lint
pnpm run typecheck
pnpm test
```

Після цього перевірте webhook, Telegram Mini App, рахунок у Stars, `/paysupport`, повернення оплати і лідерборд на тестовому користувачі.
