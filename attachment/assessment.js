// ECR-RS (Fraley, Heffernan, Vicary & Brumbaugh, 2011), relationship-specific items.
// Ukrainian translation for this site. See the page's methodology for source and license.
export const statements = [
    'У скрутні моменти мені допомагає звернутися до цієї людини.',
    'Зазвичай я розповідаю цій людині про свої проблеми й тривоги.',
    'Я обговорюю різні ситуації з цією людиною.',
    'Мені легко покластися на цю людину.',
    'Мені некомфортно відкриватися цій людині.',
    'Я волію не показувати цій людині своїх глибоких почуттів.',
    'Я часто хвилююся, що цій людині насправді байдуже до мене.',
    'Я боюся, що ця людина може мене покинути.',
    'Я хвилююся, що ця людина не так сильно піклується про мене, як я про неї.'
];

export const scale = { min: 1, max: 7 };

export function scoreAttachment(answers) {
    if (
        answers.length !== statements.length ||
        Array.from(answers).some(value => !Number.isInteger(value) || value < scale.min || value > scale.max)
    ) {
        throw new RangeError('ECR-RS requires nine integer responses from 1 to 7.');
    }
    const avoidance = answers.slice(0, 6).reduce((sum, value, index) => {
        return sum + (index < 4 ? scale.min + scale.max - value : value);
    }, 0) / 6;
    const anxiety = (answers[6] + answers[7] + answers[8]) / 3;
    return { anxiety, avoidance };
}

// Display convention for the four prototypes, independent of ECR-RS scoring.
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
