import { COMMUNITY_SPECTRA } from './community-spectra.js';

// The editor's community list is the only playable source for now. Preserve its
// wording and row IDs; repeated axes, including reversed poles, enter the deck once.
const axes = new Set();
export const SPECTRA = Object.freeze(COMMUNITY_SPECTRA.filter(card => {
  const axis = [card.left, card.right].map(pole => pole.normalize('NFC').toLocaleLowerCase('uk-UA')).sort().join('|');
  if (axes.has(axis)) return false;
  axes.add(axis);
  return true;
}));
