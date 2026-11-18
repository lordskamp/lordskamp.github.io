// ECR-R (Fraley, Waller & Brennan, 2000), in the authors' scoring order.
// Ukrainian translation for this site. The first 18 items assess anxiety, the next 18 avoidance.
export const statements = [
    'Я боюся, що партнер перестане мене кохати.',
    'Я часто хвилююся, що партнер не захоче залишатися зі мною.',
    'Я часто хвилююся, що партнер насправді мене не кохає.',
    'Я хвилююся, що мої романтичні партнери переймаються мною менше, ніж я ними.',
    'Мені часто хочеться, щоб почуття партнера до мене були такими ж сильними, як мої почуття до нього.',
    'Я багато хвилююся через свої стосунки.',
    'Коли партнера немає поруч, я хвилююся, що його може зацікавити хтось інший.',
    'Коли я показую партнерам свої почуття, то боюся, що вони не відчувають того самого до мене.',
    'Я рідко хвилююся, що партнер мене покине.',
    'Через партнера я починаю сумніватися в собі.',
    'Я нечасто хвилююся, що мене покинуть.',
    'Мені здається, що мої партнери не хочуть такої близькості, якої хочу я.',
    'Іноді почуття партнерів до мене змінюються без видимої причини.',
    'Моє прагнення до великої близькості іноді відлякує людей.',
    'Я боюся, що коли партнер краще мене пізнає, йому не сподобається, якою людиною я є насправді.',
    'Мене злить, коли від партнера я не отримую потрібної мені ніжності й підтримки.',
    'Я хвилююся, що поступаюся іншим людям.',
    'Здається, партнер помічає мене лише тоді, коли я злюся.',
    'Я волію не показувати партнеру своїх глибоких почуттів.',
    'Мені комфортно ділитися з партнером особистими думками й почуттями.',
    'Мені важко дозволити собі покладатися на романтичних партнерів.',
    'Мені дуже комфортно відчувати близькість із романтичними партнерами.',
    'Мені некомфортно відкриватися романтичним партнерам.',
    'Я волію зберігати певну дистанцію з романтичними партнерами.',
    'Мені стає некомфортно, коли романтичний партнер хоче сильно зі мною зблизитися.',
    'Мені відносно легко зблизитися з партнером.',
    'Зближення з партнером не викликає в мене труднощів.',
    'Я зазвичай обговорюю з партнером свої проблеми й переживання.',
    'У скрутні моменти мені допомагає звернутися до партнера.',
    'Я розповідаю партнеру майже про все.',
    'Я обговорюю з партнером те, що відбувається.',
    'Я нервую, коли партнери зближуються зі мною надто сильно.',
    'Мені комфортно покладатися на романтичних партнерів.',
    'Мені легко покладатися на романтичних партнерів.',
    'Мені легко проявляти ніжність до партнера.',
    'Партнер справді розуміє мене і мої потреби.'
];

export const scale = { min: 1, neutral: 4, max: 7 };
const itemsPerScale = 18;
const reverseKey = new Set([9, 11, 20, 22, 26, 27, 28, 29, 30, 31, 33, 34, 35, 36]);

export function scoreAttachment(answers) {
    if (
        answers.length !== statements.length ||
        Array.from(answers).some(value => !Number.isInteger(value) || value < scale.min || value > scale.max)
    ) {
        throw new RangeError('ECR-R requires 36 integer responses from 1 to 7.');
    }
    const keyed = answers.map((value, index) => reverseKey.has(index + 1) ? scale.min + scale.max - value : value);
    const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
        anxiety: mean(keyed.slice(0, itemsPerScale)),
        avoidance: mean(keyed.slice(itemsPerScale))
    };
}

// Display convention for the four prototypes, independent of ECR-R scoring.
export function matchAttachmentStyles({ anxiety, avoidance }) {
    const possibleLevels = score => {
        if (score < 3.5) return ['low'];
        if (score > 4.5) return ['high'];
        return ['low', 'high'];
    };
    const prototypes = {
        low: { low: 'secure', high: 'dismissive' },
        high: { low: 'anxious', high: 'fearful' }
    };
    const avoidanceLevels = possibleLevels(avoidance);
    return possibleLevels(anxiety).flatMap(level => avoidanceLevels.map(other => prototypes[level][other]));
}
