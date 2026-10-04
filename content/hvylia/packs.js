// Public catalogue only. Premium cards are selected on the server after checking
// the host's permanent purchase; guests can join the host's selected pack.
export const PACKS = Object.freeze([
  Object.freeze({
    id: 'standard',
    title: 'Звичайний',
    description: 'Повсякденні речі, культура й несподівані суперечки. Для будь-якої компанії.',
    priceStars: 0,
    count: 200,
    free: true
  }),
  Object.freeze({
    id: 'anime',
    title: 'Аніме',
    description: 'Герої, арки, магічні світи й фанатські суперечки. Для тих, хто не пропускає опенінги.',
    priceStars: 150,
    count: 100,
    free: false
  }),
  Object.freeze({
    id: 'games',
    title: 'Ігри',
    description: 'Боси, квести, ігрові світи й командні пригоди. Від затишного вечора до фінального рейду.',
    priceStars: 150,
    count: 100,
    free: false
  })
]);

export function getPack(packId) {
  return PACKS.find(pack => pack.id === packId) || null;
}
