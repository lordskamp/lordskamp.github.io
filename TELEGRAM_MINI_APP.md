# КОБЗА-НАВПАКИ as a Telegram Mini App

The game remains a static website and can now run as a Telegram Mini App. It uses the official Telegram WebApp script rather than a framework because this project is already plain HTML, CSS, and JavaScript.

## What is included

- Telegram calls `ready()` and expands the app as soon as it loads.
- Telegram light, dark, and custom themes drive the in-app UI.
- Safe-area insets protect controls on notched phones.
- A player's daily and 💩-mode progress, plus their chosen display name, are mirrored to Telegram CloudStorage. The normal browser fallback remains local storage.
- Telegram uses a native share sheet, haptic feedback, and its Back button closes game dialogs.
- The game works unchanged when opened in a normal browser.

## Connect the game to a bot

1. In Telegram, open [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Choose the bot name and a username ending in `bot`, then retain the token privately. This front-end-only version does not need the token in the repository.
3. Open `/mybots` → your bot → **Bot Settings** → **Configure Mini App**, and set the HTTPS URL for this page. For the GitHub Pages deployment, use `https://lordskamp.github.io/unwordle`.
4. Also use `/setmenubutton` to make the game the bot's menu-button experience.
5. Test from Telegram on iOS, Android, and Desktop. For local development, expose the static server with an HTTPS tunnel such as ngrok, then temporarily set that URL in BotFather.

## Score integrity

This is intentionally a front-end-only game. Telegram's visible user name is used only as a convenient default display name; it is not verified identity. The existing leaderboard endpoint therefore remains suitable for casual play only. For a trusted global ranking, add an API that validates `Telegram.WebApp.initData` with the bot token before it accepts scores.
