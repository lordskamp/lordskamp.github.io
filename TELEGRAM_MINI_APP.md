# КОБЗА-НАВПАКИ — Telegram Mini App

`@unwordle_bot` is the game entry point. The Mini App is still delivered as HTTPS files, but it launches inside Telegram as a dedicated, full-height game rather than sending players to the regular site.

## Player experience

- The bot profile has a **Грати** menu button.
- Configure a **Main Mini App** to add Telegram's prominent **Launch app** button to the bot profile.
- The game's share button creates links such as `https://t.me/unwordle_bot?startapp=p`. They open the selected game mode inside Telegram.
- `d` opens the daily game, `p` opens the 💩 mode, and `u-<difficulty>-<variation>` opens the same unlimited puzzle for every recipient.
- Results submitted from Telegram use the player's verified Telegram identity. The display name shown in the table is taken from that Telegram account; typed names are not trusted by the server. If Telegram provides a profile picture, it is shown beside that result in the rating.
- Inline mode works in private and group chats: type `@unwordle_bot`, then choose the daily, unlimited, or 💩 result. The sent card includes a **Грати** button that opens the selected Mini App mode for every participant.

## One-time BotFather setup

1. Open [@BotFather](https://t.me/BotFather) → `/mybots` → `@unwordle_bot`.
2. Choose **Bot Settings** → **Configure Mini App** → **Enable Mini App**.
3. Set the game URL to `https://lordskamp.github.io/unwordle/` and provide the required title, icon, and preview material.
4. Configure it as the bot's **Main Mini App**. This is what activates the profile-level **Launch app** button and makes the `?startapp=` share links launch the game directly.
5. Keep the menu button set to **Грати** with the same URL.
6. Send `/setinline` to BotFather and use a placeholder such as **Оберіть режим КОБЗА-НАВПАКИ**.
7. When setting the webhook, include `inline_query` in `allowed_updates` alongside `message` and `pre_checkout_query`, so the Worker can return the three inline choices.

## Protected global rating

The Cloudflare Worker in `api/kobza-leaderboard-worker.js` now checks `Telegram.WebApp.initData` before accepting a score. It derives the player identity and display name from the signed Telegram data, so two people with the same visible name keep separate results.

Before deploying this Worker version, add the bot token as a Cloudflare Worker secret named `TELEGRAM_BOT_TOKEN` and redeploy it with the existing `KOBZA_LEADERBOARD` KV binding. Do not add that token to this repository or to a GitHub Pages file.

The Worker validates the player identity but the puzzle itself still runs in the client. If the ranking later needs anti-cheat guarantees for completion time, move puzzle generation and solve verification to the Worker too.
