import { REFERENCE_CARDS } from './reference-data.js?v=24';
import { supportsSingleColorMode } from './pv3-modes.js?v=24';

// Names are the brands in the printed tables. A missing practicalCableId means
// that no handwritten operating recipe has been established for this brand.
// The generic YSLY row retains the operator's existing handwritten selection;
// its data are not assigned to any unconfirmed JZ/OZ/JB/OB variant.
const options = (cardId, brands, extra = {}) => {
  const card = REFERENCE_CARDS.find(item => item.id === cardId);
  if (!card) throw new Error(`Unknown reference card: ${cardId}`);
  const suffix = (extra.suffix ?? '').split(' · ').filter(part => !/^[\d.,/]+\s*(?:кВ|В|кВт|Вт)$/u.test(part)).join(' · ');
  return brands.map(([brand, slug, practicalCableId = null]) => ({
    id: `${cardId}--${slug}`,
    brand,
    label: `${brand === 'Speaker cable' ? 'Акустичний кабель' : brand}${suffix ? ` · ${suffix}` : ''}`,
    specification: extra.suffix ?? null,
    cardId,
    sections: card.rows.filter(row => !extra.sections || extra.sections.includes(row.section)).map(row => row.section),
    practicalCableId,
    mode: extra.mode ?? 'unknown',
    modeHint: extra.modeHint ?? 'Кількість екструдерів для цієї марки ще не уточнено.',
  }));
};

export const CATALOG_OPTIONS = [
  ...options('pvs-380', [
    ['ПВС', 'pvs', 'pvs-shvvp'], ['ПВСнг', 'pvsng'],
    ['ПВСнгд', 'pvsngd'], ['ШВВП', 'shvvp', 'pvs-shvvp'],
  ], { suffix: '380 В', mode: 'dual', modeHint: 'У довідковій карті є оберти обох екструдерів.' }),
  ...options('vvg-066', [
    ['ВВГ', 'vvg', 'vvg'], ['ВВГнгд', 'vvgngd'], ['ВВГнг-LS', 'vvgng-ls'],
    ['ВВГнг', 'vvgng'], ['ВВГзнг', 'vvgzng'],
  ], { suffix: '0,66 кВ', modeHint: 'Два екструдери підтверджено для практичних записів ВВГ 1,5 і 2,5 мм².' }),
  ...options('vvg-p-066', [
    ['ВВГ-П', 'vvg-p'], ['ВВГнг-П', 'vvgng-p', 'vvgng-p'],
  ], { suffix: '0,66 кВ', modeHint: 'Практичні записи ВВГ перенесено на ВВГнг-П за підтвердженням оператора.' }),
  ...options('pv1', [
    ['ПВ1', 'pv1', 'pv1'], ['ПВ1нг', 'pv1ng'], ['ПВ1нгд', 'pv1ngd'],
  ], { mode: 'single', modeHint: 'Один екструдер підтверджено для практичних записів ПВ1 1,5 і 2,5 мм²; для інших марок режим не підтверджено.' }),
  ...options('pv3', [
    ['ПВ3', 'pv3', 'pv3'], ['ПВ3нг', 'pv3ng'], ['ПВ3нгд', 'pv3ngd'],
  ], { mode: 'single', modeHint: 'ПВ3: один екструдер для суцільного кольору, два — для жовто-зеленого. Пари в рукописі належать режиму з двома екструдерами.' }),
  ...options('pv5', [
    ['ПВ5', 'pv5'], ['ПВ5нг', 'pv5ng'], ['ПВ5нгд', 'pv5ngd'],
  ]),
  ...options('vvg3', [
    ['ВВГз', 'vvgz'], ['ВВГзнг', 'vvgzng'], ['ВВГзнгд', 'vvgzngd'],
    ['ВВГзз', 'vvgzz'], ['ВВГззнг', 'vvgzzng'], ['ВВГззнгд', 'vvgzzngd'],
    ['ВВГз-П', 'vvgz-p'], ['ВВГзнг-П', 'vvgzng-p'], ['ВВГзнгд-П', 'vvgzngd-p'],
  ], { suffix: 'клас 3 · 0,66 кВ' }),
  ...['u', 'r', 'k'].flatMap(id => [
    ...options(`h07v-${id}`, [[`H05V-${id.toUpperCase()}`, `h05v-${id}`]], { sections: [.5, .75, 1] }),
    ...options(`h07v-${id}`, [[`H07V-${id.toUpperCase()}`, `h07v-${id}`, id === 'u' ? 'pv1' : null]], {
      sections: [1.5, 2.5, 4, 6],
      mode: id === 'u' ? 'single' : 'unknown',
      modeHint: id === 'u' ? 'ПВ1 / H07V-U прямо підписано у DRAW_1; один екструдер підтверджено для записів 1,5 і 2,5 мм².' : 'Кількість екструдерів для цієї марки ще не уточнено.',
    }),
  ]),
  ...options('ysly-shared', [
    ['YSLY', 'ysly', 'ysly'],
    ['YSLY-JZ', 'ysly-jz'], ['YSLY-OZ', 'ysly-oz'], ['YSLY-JB', 'ysly-jb'], ['YSLY-OB', 'ysly-ob'],
    ['MYYS', 'myys'], ['05VV-F', '05vv-f'], ['(H)05VV-F', 'h-05vv-f', 'h05vv-f'], ['H05VV-F', 'h05vv-f', 'h05vv-f'],
    ['Z-FLEX CLASSIC-JB', 'z-flex-classic-jb'], ['Z-FLEX CLASSIC-OB', 'z-flex-classic-ob'],
    ['Z-FLEX CLASSIC-JZ', 'z-flex-classic-jz'], ['Z-FLEX CLASSIC-OZ', 'z-flex-classic-oz'],
  ], { suffix: 'спільна карта', modeHint: 'Два екструдери підтверджено для практичних записів YSLY / (H)05VV-F; конкретні суфікси YSLY у рукописі не зазначені.' }),
  ...options('h03-en', [
    ['H03VV-F', 'h03vv-f'], ['H03VVH2-F', 'h03vvh2-f'],
    ['(H)03VVH2-F', 'h-03vvh2-f'], ['(H)03VV-F', 'h-03vv-f'],
  ], { suffix: 'EN', mode: 'dual', modeHint: 'У довідковій карті є оберти обох екструдерів.' }),
  ...options('h05-en', [
    ['H05VV-F', 'h05vv-f'], ['H05VVH2-F', 'h05vvh2-f'], ['(H)05VV-F', 'h-05vv-f'],
  ], { suffix: 'EN', mode: 'dual', modeHint: 'У довідковій карті є оберти обох екструдерів.' }),
  ...options('cykyl-u', [['CYKYL-U', 'cykyl-u']], { suffix: '0,3/0,5 кВ' }),
  ...options('cykyl-f-geometry', [['CYKYL-F', 'cykyl-f']], { suffix: 'карта геометрії' }),
  ...options('speaker', [
    ['Speaker cable', 'speaker'], ['NYFAZ', 'nyfaz'], ['LFZ-XY', 'lfz-xy'], ['LSZ-XY', 'lsz-xy'],
  ], { modeHint: 'Для 2×0,75 та 2×1,5 є рукописні оберти обох екструдерів. Розміри інструмента — подвійні та плоскі.' }),
  ...options('xymm', [['XYMM', 'xymm']], { suffix: '450/750 В', mode: 'dual', modeHint: 'Додатковий екструдер для поверхневого кольору прямо вказаний у довідці.' }),
  ...options('yms-j', [['YMS-J', 'yms-j']], { suffix: '0,6/1 кВ' }),
  ...options('cykyl-f-partial', [['CYKYL-F', 'cykyl-f']], { suffix: 'карта конструкції' }),
  ...options('h05-partial', [['H05VV-F', 'h05vv-f']], { suffix: 'карта конструкції' }),
  ...options('pvs-e', [['ПВСе', 'pvse']], { suffix: 'EUROLUMINA' }),
  ...options('ysly-1000', [
    ['YSLY-JZ', 'ysly-jz'], ['YSLY-OZ', 'ysly-oz'], ['YSLY-JB', 'ysly-jb'], ['YSLY-OB', 'ysly-ob'],
  ], { suffix: '600/1000 В', mode: 'dual', modeHint: 'У довідковій карті є оберти обох екструдерів.' }),
  {
    id: 'thread-bundle', brand: 'Джгути', label: 'Джгути', cardId: 'thread-bundle', coreKind: 'thread',
    specification: null, sections: [1], practicalCableId: null, mode: 'unknown',
    modeHint: 'Режим роботи визначається за практичним заміром.',
  },
].map(option => {
  // Colour requirements now establish the normal mode for all confirmed H*/ПВ*
  // families. Retain the original source mode: printed dual RPM cannot become
  // single-extruder settings just because an ordinary colour uses one extruder.
  if (supportsSingleColorMode(option)) return { ...option, referenceMode: option.mode, mode: 'single',
    modeHint: 'Синій і жовто-зелений — два екструдери. Для інших кольорів можна працювати одним. Значення належать режиму роботи, а не кольору.' };
  // A mode confirmed for a base brand cannot establish its flame-retardant variants.
  if ((option.cardId === 'pv1' || option.cardId === 'pv3') && !option.practicalCableId) {
    return { ...option, mode: 'unknown', modeHint: 'Кількість екструдерів для цієї марки ще не уточнено.' };
  }
  if (['vvg', 'vvgng-p', 'ysly', 'h05vv-f'].includes(option.practicalCableId)) return { ...option, mode: 'dual' };
  return option;
});

export function catalogOption(id) {
  return CATALOG_OPTIONS.find(option => option.id === id) ?? null;
}
