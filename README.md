# lordskamp.github.io

Статичний GitHub Pages-сайт Lordskamp із портфоліо та іграми. Серверні можливості працюють через Cloudflare Worker у `api/kobza-leaderboard-worker.js`.

## Обпресування

`/Zavod/` — довідник налаштувань екструдерів, Сікори та інструментів, план барабанів за кольорами й журнал метрових позначок пробою. Працює як звичайна сторінка та [Telegram Mini App](https://t.me/obpresyvanya_bot?startapp). Власні уточнення й план зберігаються локально в браузері. Дані: `Zavod/data.js`; формули: `Zavod/core.js`.

Джерела й невизначені записи описані у [ZAVOD-SOURCES.md](docs/ZAVOD-SOURCES.md), друковані карти — у [ZAVOD-PRINTED.md](docs/ZAVOD-PRINTED.md), підключення Telegram — у [ZAVOD-TELEGRAM.md](docs/ZAVOD-TELEGRAM.md). Окрема перевірка розрахунків: `node --test tests/zavod-core.test.mjs`.

## Шифр

Українська гра «Шифр» відкривається за маршрутом `/shyfr/`. Рівні зберігаються по одному JSON-файлу на категорію; кожен запис містить лише `text` і `source`. Інструкції для локального запуску, Cloudflare KV, Telegram Mini App, Stars і BotFather наведені в [`docs/SHYFR.md`](docs/SHYFR.md).

```powershell
pnpm install
pnpm run validate:shyfr-content
pnpm run check:shyfr-duplicates
pnpm run build:shyfr-content-index
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

Не додавайте bot token, webhook secret, admin token або повний Telegram `initData` до репозиторію.
