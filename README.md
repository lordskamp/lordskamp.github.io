# lordskamp.github.io

Статичний GitHub Pages-сайт Lordskamp із портфоліо та іграми. Серверні можливості працюють через Cloudflare Worker у `api/kobza-leaderboard-worker.js`.

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
