// The solo preview and multiplayer server run the exact same rules.
// This module contains public rules and spectra; active room secrets remain in the server's storage.
export { createRoom, addPlayer, applyAction, viewFor, GAME_CONFIG } from '../api/hvylia-core.js';
