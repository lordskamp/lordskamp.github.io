import { SPECTRA } from './spectra.js';

// Only the editor's community cards are active. Historical paid entitlements are
// kept in account storage; unavailable packs are neither offered nor sold.
export const PACKS = Object.freeze([
  Object.freeze({
    id: 'standard',
    title: 'Звичайний',
    description: 'Українські спектри для будь-якої компанії.',
    priceStars: 0,
    count: SPECTRA.length,
    free: true
  })
]);

export function getPack(packId) {
  return PACKS.find(pack => pack.id === packId) || null;
}
