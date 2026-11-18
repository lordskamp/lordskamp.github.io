import { matchAttachmentStyles, scale, scoreAttachment, statements } from './assessment.js?v=ecr-r';

const styles = {
    secure: {
        name: 'Надійний',
        description: 'У романтичних стосунках тобі здебільшого комфортно відкриватися й покладатися на іншу людину. Твої відповіді також вказують, що ти рідше хвилюєшся через можливе відкидання.'
    },
    anxious: {
        name: 'Тривожний',
        description: 'Тобі здебільшого комфортно зближуватися, але ти можеш часто хвилюватися, чи твої почуття взаємні й чи інша людина залишиться поруч.'
    },
    dismissive: {
        name: 'Уникаючий',
        description: 'Ти рідше хвилюєшся через можливе відкидання, але можеш відчувати дискомфорт, коли потрібно відкриватися або покладатися на іншу людину.'
    },
    fearful: {
        name: 'Тривожно-уникаючий',
        description: 'Занепокоєння, що тебе можуть відкинути, поєднується з дискомфортом від близькості. Тобі може бути складно і відкриватися, і почуватися впевнено у взаємності.'
    }
};

const byId = id => document.getElementById(id);
const screens = [byId('intro'), byId('question'), byId('result')];
const form = byId('quiz');
const slider = byId('agreement');
const agreementValue = byId('agreement-value');
const agreementLabels = [
    'Зовсім не погоджуюся',
    'Не погоджуюся',
    'Скоріше не погоджуюся',
    'Нейтрально',
    'Скоріше погоджуюся',
    'Погоджуюся',
    'Повністю погоджуюся'
];
const next = byId('next');
const plot = byId('plot');
const numberFormat = new Intl.NumberFormat('uk', { maximumFractionDigits: 2 });
const answers = Array(statements.length).fill(null);
let order = shuffleStatements();
let step = 0;

function shuffleStatements() {
    const indices = statements.map((_, index) => index);
    for (let index = indices.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
    }
    return indices;
}

function showScreen(screen) {
    screens.forEach(section => { section.hidden = section !== screen; });
    screen.querySelector('[tabindex="-1"]').focus({ preventScroll: true });
    window.scrollTo(0, 0);
}

function showIntro() {
    byId('start-label').textContent = answers.some(value => value !== null) ? 'Продовжити тест' : 'Почати тест';
    showScreen(screens[0]);
}

function showQuestion() {
    const item = order[step];
    byId('progress-label').textContent = `Твердження ${step + 1} із ${statements.length}`;
    byId('progress').value = step + 1;
    byId('question-title').textContent = statements[item];
    slider.value = answers[item] ?? scale.neutral;
    renderAgreement(answers[item]);
    byId('next-label').textContent = step === statements.length - 1 ? 'Показати результат' : 'Далі';
    showScreen(screens[1]);
}

function renderAgreement(value) {
    const chosen = value !== null;
    const label = chosen ? `${value} із ${scale.max} · ${agreementLabels[value - scale.min]}` : 'Обери позицію на шкалі';
    agreementValue.textContent = label;
    slider.setAttribute('aria-valuetext', chosen ? label : 'Нейтральна позиція. Натисни пробіл, щоб її обрати.');
    slider.classList.toggle('is-answered', chosen);
    next.disabled = !chosen;
}

function chooseAgreement() {
    const value = Number(slider.value);
    answers[order[step]] = value;
    renderAgreement(value);
}

function plotPosition(score) {
    return `${100 * (score - scale.min) / (scale.max - scale.min)}%`;
}

function showResult() {
    const { anxiety, avoidance } = scoreAttachment(answers);
    const matches = matchAttachmentStyles({ anxiety, avoidance });
    const isClear = matches.length === 1;
    byId('result-label').textContent = isClear ? 'Орієнтовний стиль прив’язаності' : 'Твій профіль прив’язаності';
    byId('result-title').textContent = isClear ? styles[matches[0]].name : 'Профіль на межі стилів';
    let description;
    if (isClear) {
        description = styles[matches[0]].description;
    } else if (matches.length === 2) {
        const names = matches.map(key => styles[key].name.toLowerCase()).join(' і ');
        description = `Один із балів близький до середини шкали. Два можливі стилі — ${names}.`;
    } else {
        description = 'Обидва бали близькі до середини. Подивись на них окремо, щоб зрозуміти, як ти відповідаєш на твердження про близькість і взаємність.';
    }
    byId('result-description').textContent = description;
    byId('anxiety-score').textContent = numberFormat.format(anxiety);
    byId('avoidance-score').textContent = numberFormat.format(avoidance);
    plot.style.setProperty('--anxiety', plotPosition(anxiety));
    plot.style.setProperty('--avoidance', plotPosition(avoidance));
    plot.querySelectorAll('[data-style]').forEach(cell => {
        cell.classList.toggle('is-match', matches.length < 4 && matches.includes(cell.dataset.style));
    });
    showScreen(screens[2]);
}

slider.addEventListener('input', chooseAgreement);
slider.addEventListener('click', chooseAgreement);
slider.addEventListener('keydown', event => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    chooseAgreement();
});

form.addEventListener('submit', event => {
    event.preventDefault();
    if (answers[order[step]] === null) return;
    if (step === statements.length - 1) {
        showResult();
        return;
    }
    step += 1;
    showQuestion();
});

byId('previous').addEventListener('click', () => {
    if (step === 0) {
        showIntro();
        return;
    }
    step -= 1;
    showQuestion();
});

byId('start').addEventListener('click', showQuestion);
byId('edit').addEventListener('click', showQuestion);
byId('restart').addEventListener('click', () => {
    answers.fill(null);
    order = shuffleStatements();
    step = 0;
    showIntro();
});
byId('progress').max = statements.length;
byId('start').disabled = false;
