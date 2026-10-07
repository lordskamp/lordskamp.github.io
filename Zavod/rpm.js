import { number, positive, limitPredictedExtruder2 } from './core.js?v=23';
import { TRIAL_LIMIT, OPERATOR_REFERENCE, OPERATOR_HANDWRITTEN } from './operator-data.js';
import { referenceFor } from './reference-data.js';

// A trial at another speed of the same recipe, not a forecast for a new wire section.
export function trialRpm(recipe, target, color) {
  const speed = positive(target), baseSpeed = positive(recipe.maxSpeed);
  const empty = message => ({ first:null, second:null, message });
  if (String(target ?? '').trim()==='') return empty('Вкажи швидкість для прогнозу.');
  if (!speed) return empty('Вкажи швидкість більшу за нуль.');
  if (!baseSpeed || number(recipe.extruder1)===null) return empty('Немає запису обертів і швидкості для цього режиму.');
  if (recipe.mode==='unknown' || recipe.cableId==='pv3'&&recipe.mode==='dual'&&recipe.origin!=='measurement') return empty('Спочатку уточни режим екструдерів і колір.');
  if (recipe.mode==='single'&&color==='yellow-green') return empty('Режим для жовто-зеленого ще не уточнено.');
  if (speed>baseSpeed) return empty('Швидкість перевищує записаний максимум.');
  if (Math.abs(speed/baseSpeed-1)>TRIAL_LIMIT+1e-9) return empty('Для більшої зміни швидкості потрібен замір.');
  const scale = value => number(value)===null ? null : Math.round(number(value)*speed/baseSpeed*10)/10;
  const first = scale(recipe.extruder1), rawSecond = recipe.mode==='single'?null:scale(recipe.extruder2);
  return {first,second:limitPredictedExtruder2(first,rawSecond),message:'Той самий режим · орієнтир для проби.'};
}

/** Approximate feed adjustment for one unchanged wire, insulation and machine mode. */
export function speedRpm(recipe, target) {
  const speed = positive(target), baseSpeed = positive(recipe.maxSpeed);
  const empty = message => ({ first: null, second: null, message });
  if (!speed) return empty('Вкажи швидкість більшу за нуль.');
  if (!['single', 'dual'].includes(recipe.mode) || !baseSpeed || !positive(recipe.extruder1)
      || recipe.mode === 'dual' && !positive(recipe.extruder2)) return empty('Для перерахунку потрібні оберти та швидкість цього режиму.');
  const scale = value => Math.round(number(value) * speed / baseSpeed * 10) / 10;
  const first = scale(recipe.extruder1), second = recipe.mode === 'dual' ? limitPredictedExtruder2(first,scale(recipe.extruder2)) : null;
  if (![first, second ?? first].every(value => Number.isFinite(value) && value > 0)) return empty('Вкажи швидкість, за якої оберти більші за нуль.');
  return { first, second, message: 'Орієнтовно · за твоєю швидкістю' };
}

export function additionalRpm(recipe, extruder) {
  const key = `extruder${extruder}`;
  const handwritten = OPERATOR_HANDWRITTEN.find(r=>r.id===(recipe.baseId||recipe.id));
  const result = [];
  if (handwritten?.[key]!=null && handwritten[key]!==recipe[key] && !(extruder===2&&recipe.mode==='single')) result.push({label:'Рукопис колеги',value:handwritten[key],source:handwritten.source});
  for (const card of referenceFor(recipe.cableId)) {
    const row = OPERATOR_REFERENCE.find(r=>r.cardId===card.id&&r.section===recipe.section);
    if (row?.[`reference${extruder}`]!=null) result.push({label:card.id==='ysly-1000'?'Довідка 600/1000 В':card.id==='h05-en'?'Довідка EN':'Довідка',value:row[`reference${extruder}`],source:row.referenceSource});
  }
  return result;
}

export function handwrittenAlternatives(recipe) {
  if (recipe.cableId!=='pv3') return null;
  return ({.75:'68; 57; пара 65/85',4:'74 або пара 64/80',6:'67 або пара 64/84'})[recipe.section] ?? null;
}
