#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Збір і форматування строф української класичної поезії для гри «Криптограма».

Джерело: українські Вікіджерела (MediaWiki API).
Популярність творів: безкоштовний Wikimedia Pageviews API.

Вихід: output.json — JSON Array з об'єктами:
{
  "text": "Очищений текст строфи в один рядок",
  "source": "Автор — «Назва твору» | Посилання"
}

Python: 3.10+
Залежності: requests, beautifulsoup4
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import re
import sys
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable, Iterator, Sequence
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup, Tag
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


# ---------------------------------------------------------------------------
# Моделі даних
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WorkSeed:
    author: str
    title: str
    famous_fragments: tuple[str, ...] = ()


@dataclass(frozen=True)
class ResolvedWork:
    seed: WorkSeed
    page_title: str
    url: str


@dataclass(frozen=True)
class Candidate:
    text: str
    source: str
    author: str
    title: str
    page_title: str
    pageviews: int
    score: float
    order: int



# ---------------------------------------------------------------------------
# Налаштування
# ---------------------------------------------------------------------------

WIKISOURCE_API = "https://uk.wikisource.org/w/api.php"
WIKISOURCE_BASE = "https://uk.wikisource.org/wiki/"
PAGEVIEWS_BASE = (
    "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article"
)
WIKIMEDIA_PROJECT = "uk.wikisource.org"

# Wikimedia просить вказувати зрозумілий User-Agent. За бажанням додайте контакт.
USER_AGENT = (
    "CryptogramPoetryCollector/1.0 "
    "(personal educational project; Ukrainian poetry dataset)"
)

MIN_CHARS = 60
MAX_CHARS = 150
DEFAULT_OUTPUT = "output.json"
DEFAULT_LIMIT = 100
DEFAULT_PER_WORK = 3
DEFAULT_PAGEVIEW_DAYS = 365
REQUEST_DELAY_SECONDS = 0.20

# Пошукові «зерна». Скрипт не зберігає тексти — лише знаходить сторінки та
# завантажує їх під час запуску. Список можна вільно розширювати.
SEED_WORKS: tuple["WorkSeed", ...] = (
    # Тарас Шевченко
    WorkSeed("Тарас Шевченко", "Заповіт", ("Як умру, то поховайте",)),
    WorkSeed(
        "Тарас Шевченко",
        "Садок вишневий коло хати",
        ("Садок вишневий коло хати",),
    ),
    WorkSeed(
        "Тарас Шевченко",
        "Причинна",
        ("Реве та стогне Дніпр широкий",),
    ),
    WorkSeed(
        "Тарас Шевченко",
        "Мені тринадцятий минало",
        ("Мені тринадцятий минало",),
    ),
    WorkSeed(
        "Тарас Шевченко",
        "Думи мої, думи мої",
        ("Думи мої, думи мої",),
    ),
    WorkSeed(
        "Тарас Шевченко",
        "І мертвим, і живим, і ненарожденним",
        ("І мертвим, і живим", "Учітесь, читайте"),
    ),
    WorkSeed("Тарас Шевченко", "Кавказ", ("Борітеся — поборете",)),
    WorkSeed(
        "Тарас Шевченко",
        "Тече вода з-під явора",
        ("Тече вода з-під явора",),
    ),
    # Леся Українка
    WorkSeed(
        "Леся Українка",
        "Contra spem spero!",
        ("Гетьте, думи, ви хмари осінні", "Без надії сподіваюсь"),
    ),
    WorkSeed("Леся Українка", "Давня весна", ("Була весна весела",)),
    WorkSeed(
        "Леся Українка",
        "Хотіла б я піснею стати",
        ("Хотіла б я піснею стати",),
    ),
    WorkSeed(
        "Леся Українка",
        "Стояла я і слухала весну",
        ("Стояла я і слухала весну",),
    ),
    WorkSeed(
        "Леся Українка",
        "Слово, чому ти не твердая криця",
        ("Слово, чому ти не твердая криця",),
    ),
    WorkSeed("Леся Українка", "Мріє, не зрадь", ("Мріє, не зрадь",)),
    WorkSeed(
        "Леся Українка",
        "Красо України, Подолля!",
        ("Красо України, Подолля",),
    ),
    # Іван Франко
    WorkSeed(
        "Іван Франко",
        "Чого являєшся мені у сні?",
        ("Чого являєшся мені у сні",),
    ),
    WorkSeed("Іван Франко", "Каменярі", ("Лупайте сю скалу",)),
    WorkSeed("Іван Франко", "Гімн", ("Вічний революціонер",)),
    WorkSeed(
        "Іван Франко",
        "Ой ти, дівчино, з горіха зерня",
        ("Ой ти, дівчино, з горіха зерня",),
    ),
    WorkSeed("Іван Франко", "Не пора", ("Не пора, не пора",)),
    WorkSeed(
        "Іван Франко",
        "Земле, моя всеплодющая мати",
        ("Земле, моя всеплодющая мати",),
    ),
    WorkSeed("Іван Франко", "Сікстинська мадонна", ("Хто смів сказать",)),
    # Інші класики
    WorkSeed("Леонід Глібов", "Журба", ("Стоїть гора високая",)),
    WorkSeed(
        "Степан Руданський",
        "Повій, вітре, на Вкраїну",
        ("Повій, вітре, на Вкраїну",),
    ),
    WorkSeed(
        "Михайло Старицький",
        "Виклик",
        ("Ніч яка, Господи, місячна, зоряна",),
    ),
    WorkSeed(
        "Олександр Олесь",
        "Чари ночі",
        ("Сміються, плачуть солов'ї",),
    ),
    WorkSeed("Олександр Олесь", "Айстри", ("Айстри задумані",)),
    WorkSeed(
        "Олександр Олесь",
        "З журбою радість обнялась",
        ("З журбою радість обнялась",),
    ),
    WorkSeed("Микола Вороний", "Блакитна Панна", ("Блакитна Панна",)),
    WorkSeed("Микола Вороний", "Євшан-зілля", ("Євшан-зілля",)),
    WorkSeed("Павло Грабовський", "Швачка", ("Рученьки терпнуть",)),
)

# Елементи сторінки, які не є текстом твору.
REMOVE_SELECTORS = (
    "script",
    "style",
    "noscript",
    "table",
    "figure",
    "audio",
    "video",
    "sup.reference",
    ".mw-editsection",
    ".mw-references-wrap",
    ".references",
    ".noprint",
    ".navbox",
    ".catlinks",
    ".printfooter",
    ".licenseContainer",
    ".ws-noexport",
    ".header-container",
    ".headertemplate",
    ".mw-heading",
)

# Типові службові фрагменти, які можуть потрапити у fallback-видобування.
NOISE_PATTERNS = (
    r"^Матеріал з Вікіджерел",
    r"^Перейти до навігації",
    r"^Перейти до пошуку",
    r"^Джерело[: ]",
    r"^Примітки$",
    r"^Література$",
    r"^Посилання$",
    r"^Навігаційне меню$",
    r"^Особисті інструменти$",
    r"^Простори назв$",
    r"^Перегляди$",
    r"^Ще$",
    r"^Пошук$",
    r"^З Вікіджерел",
    r"^Цей текст доступний",
    r"^Твори цього автора",
    r"^Автор[: ]",
    r"^Назва[: ]",
    r"^Рік[: ]",
    r"^←|^→",
)
NOISE_RE = re.compile("|".join(NOISE_PATTERNS), re.IGNORECASE)

UKRAINIAN_LETTERS_RE = re.compile(r"[А-Яа-яІіЇїЄєҐґ]")
ALL_LETTERS_RE = re.compile(r"[A-Za-zА-Яа-яІіЇїЄєҐґ]")
FOOTNOTE_RE = re.compile(r"\[\s*\d+[а-яa-z]?\s*\]", re.IGNORECASE)
MULTISPACE_RE = re.compile(r"[ \t]+")
MULTIBLANK_RE = re.compile(r"\n\s*\n(?:\s*\n)+")


# ---------------------------------------------------------------------------
# HTTP-клієнт
# ---------------------------------------------------------------------------


def build_session() -> requests.Session:
    """Створює requests.Session із повторними спробами для тимчасових помилок."""
    retry = Retry(
        total=4,
        connect=4,
        read=4,
        backoff_factor=0.8,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10)

    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
            "Accept-Language": "uk,en;q=0.5",
        }
    )
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def request_json(
    session: requests.Session,
    url: str,
    *,
    params: dict[str, object] | None = None,
    timeout: tuple[int, int] = (10, 35),
    delay: float = REQUEST_DELAY_SECONDS,
) -> dict:
    """GET-запит із перевіркою HTTP-коду та JSON-відповіді."""
    try:
        response = session.get(url, params=params, timeout=timeout)
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as exc:
        raise RuntimeError(f"Помилка HTTP-запиту до {url}: {exc}") from exc
    except ValueError as exc:
        raise RuntimeError(f"Сервер {url} повернув некоректний JSON") from exc
    finally:
        if delay > 0:
            time.sleep(delay)

    if isinstance(data, dict) and "error" in data:
        error = data["error"]
        raise RuntimeError(
            f"API повернув помилку: {error.get('code', 'unknown')} — "
            f"{error.get('info', error)}"
        )
    return data


def mediawiki_get(session: requests.Session, **params: object) -> dict:
    """Запит до MediaWiki API з базовими параметрами."""
    merged: dict[str, object] = {
        "format": "json",
        "formatversion": 2,
        "maxlag": 5,
    }
    merged.update(params)
    return request_json(session, WIKISOURCE_API, params=merged)


# ---------------------------------------------------------------------------
# Пошук сторінок творів
# ---------------------------------------------------------------------------


def normalize_for_match(value: str) -> str:
    value = unicodedata.normalize("NFC", value).casefold()
    value = value.replace("’", "'").replace("ʼ", "'").replace("`", "'")
    value = re.sub(r"[^a-zа-яіїєґ0-9]+", " ", value, flags=re.IGNORECASE)
    return MULTISPACE_RE.sub(" ", value).strip()


def author_surname(author: str) -> str:
    parts = normalize_for_match(author).split()
    return parts[-1] if parts else ""


def score_search_result(seed: WorkSeed, result: dict) -> float:
    candidate_title = str(result.get("title", ""))
    snippet_html = str(result.get("snippet", ""))
    snippet = BeautifulSoup(snippet_html, "html.parser").get_text(" ")

    wanted = normalize_for_match(seed.title)
    candidate = normalize_for_match(candidate_title)
    combined = normalize_for_match(candidate_title + " " + snippet)
    surname = author_surname(seed.author)

    ratio = SequenceMatcher(None, wanted, candidate).ratio()
    score = ratio * 60.0

    if candidate == wanted:
        score += 100.0
    elif wanted and wanted in candidate:
        score += 60.0
    elif candidate and candidate in wanted:
        score += 25.0

    if surname and surname in combined:
        score += 30.0

    # Підсторінки збірок часто містять точний твір, тому невеликий бонус.
    if "/" in candidate_title and wanted in candidate:
        score += 8.0

    # Сторінки-списки менш бажані за сторінки конкретних творів.
    lowered = candidate_title.casefold()
    if any(word in lowered for word in ("збірка", "список", "твори", "зміст")):
        score -= 25.0

    return score


def search_work(session: requests.Session, seed: WorkSeed) -> ResolvedWork | None:
    """Знаходить найімовірнішу сторінку твору через пошук MediaWiki."""
    surname = author_surname(seed.author)
    queries = (
        f'intitle:"{seed.title}" "{surname}"',
        f'"{seed.title}" "{seed.author}"',
        f'intitle:"{seed.title}"',
        seed.title,
    )

    best_result: dict | None = None
    best_score = float("-inf")

    for query in queries:
        try:
            data = mediawiki_get(
                session,
                action="query",
                list="search",
                srsearch=query,
                srnamespace=0,
                srlimit=10,
                srprop="snippet|titlesnippet",
            )
        except RuntimeError as exc:
            logging.warning("Пошук %s — «%s»: %s", seed.author, seed.title, exc)
            continue

        results = data.get("query", {}).get("search", [])
        for result in results:
            title = str(result.get("title", ""))
            if not title or title.startswith(("Категорія:", "Автор:", "Сторінка:", "Індекс:")):
                continue
            score = score_search_result(seed, result)
            if score > best_score:
                best_result = result
                best_score = score

        # Достатньо надійний збіг — немає сенсу робити додаткові запити.
        if best_result is not None and best_score >= 115:
            break

    if best_result is None or best_score < 45:
        logging.warning("Не знайдено надійну сторінку: %s — «%s»", seed.author, seed.title)
        return None

    page_title = str(best_result["title"])
    url = WIKISOURCE_BASE + quote(page_title.replace(" ", "_"), safe="/()!,'")
    return ResolvedWork(seed=seed, page_title=page_title, url=url)


# ---------------------------------------------------------------------------
# Завантаження й очищення HTML
# ---------------------------------------------------------------------------


def fetch_rendered_page(
    session: requests.Session, page_title: str
) -> tuple[str, str]:
    """Повертає (фактичний заголовок сторінки, відрендерений HTML)."""
    data = mediawiki_get(
        session,
        action="parse",
        page=page_title,
        prop="text|displaytitle",
        disableeditsection=1,
        disabletoc=1,
        redirects=1,
    )
    parsed = data.get("parse")
    if not isinstance(parsed, dict):
        raise RuntimeError(f"У відповіді немає секції parse для сторінки {page_title}")

    html = parsed.get("text")
    if not isinstance(html, str) or not html.strip():
        raise RuntimeError(f"Порожній HTML сторінки {page_title}")

    actual_title = str(parsed.get("title") or page_title)
    return actual_title, html


def remove_unwanted_elements(root: Tag | BeautifulSoup) -> None:
    for selector in REMOVE_SELECTORS:
        for element in root.select(selector):
            element.decompose()

    # Редакторські позначки на Вікіджерелах.
    for element in root.find_all(attrs={"data-nosnippet": True}):
        element.decompose()


def top_level_poem_nodes(content: Tag | BeautifulSoup) -> list[Tag]:
    """Повертає poem-вузли без вкладених дублікатів."""
    found = content.select(
        "div.poem, div.ws-poem, div.poem-container, "
        "section.poem, blockquote.poem, .poemtext"
    )
    selected_ids = {id(node) for node in found}
    result: list[Tag] = []

    for node in found:
        parent = node.parent
        nested = False
        while isinstance(parent, Tag):
            if id(parent) in selected_ids:
                nested = True
                break
            parent = parent.parent
        if not nested:
            result.append(node)
    return result


def html_node_to_text(node: Tag) -> str:
    """Перетворює HTML-вузол на текст, зберігаючи розриви рядків/строф."""
    clone_soup = BeautifulSoup(str(node), "html.parser")
    root = clone_soup.find()
    if root is None:
        return ""

    remove_unwanted_elements(root)

    for br in root.find_all("br"):
        br.replace_with("\n")

    # Додаємо межі між блоками. Символи не потраплять у готовий JSON,
    # вони потрібні лише для відновлення строф.
    for tag in root.find_all(["p", "div", "blockquote", "section", "dd", "li"]):
        tag.append("\n\n")

    text = root.get_text("", strip=False)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00a0", " ").replace("\u202f", " ")
    text = text.replace("\u200b", "").replace("\ufeff", "")
    text = MULTIBLANK_RE.sub("\n\n", text)
    return text.strip()


def extract_raw_poem_texts(html: str) -> list[str]:
    """Видобуває poem-блоки; якщо їх немає — використовує основний контент."""
    soup = BeautifulSoup(html, "html.parser")
    content = soup.select_one(".mw-parser-output") or soup
    remove_unwanted_elements(content)

    poem_nodes = top_level_poem_nodes(content)
    if poem_nodes:
        texts = [html_node_to_text(node) for node in poem_nodes]
        return [text for text in texts if text.strip()]

    # Fallback для старих або нестандартно оформлених сторінок.
    fallback = html_node_to_text(content)
    return [fallback] if fallback.strip() else []


# ---------------------------------------------------------------------------
# Поділ на строфи та приведення до 60–150 символів
# ---------------------------------------------------------------------------


def clean_line(line: str) -> str:
    line = unicodedata.normalize("NFC", line)
    line = line.replace("\u00a0", " ").replace("\u202f", " ")
    line = line.replace("\u200b", "").replace("\ufeff", "")
    line = FOOTNOTE_RE.sub("", line)
    line = MULTISPACE_RE.sub(" ", line)
    # Видаляємо лише очевидні технічні маркери, не чіпаючи пунктуацію твору.
    line = re.sub(r"^(?:\[?ред\.?\]?|↑)\s*", "", line, flags=re.IGNORECASE)
    return line.strip()


def is_noise_line(line: str) -> bool:
    if not line:
        return True
    if NOISE_RE.search(line):
        return True
    if re.fullmatch(r"[\dIVXLCDMivxlcdm.()\[\]—–-]+", line):
        return True
    if "http://" in line or "https://" in line:
        return True
    return False


def looks_like_ukrainian_poetry(text: str) -> bool:
    if not (MIN_CHARS <= len(text) <= MAX_CHARS):
        return False

    letters = ALL_LETTERS_RE.findall(text)
    if len(letters) < 20:
        return False

    ukrainian = UKRAINIAN_LETTERS_RE.findall(text)
    if len(ukrainian) / len(letters) < 0.72:
        return False

    if NOISE_RE.search(text):
        return False
    if text.count("|") >= 2:
        return False
    return True


def one_line(lines: Sequence[str]) -> str:
    text = " ".join(part.strip() for part in lines if part.strip())
    return re.sub(r"\s+", " ", text).strip()


def sentence_units(text: str) -> list[str]:
    """Ділить наддовгий рядок за реченнями/частинами, не змінюючи пунктуацію."""
    units = re.split(r"(?<=[.!?…;:])\s+|(?<=,)\s+", text)
    return [unit.strip() for unit in units if unit.strip()]


def word_units(text: str) -> list[str]:
    """Останній fallback: поділ на слова для рядка довшого за MAX_CHARS."""
    return text.split()


def greedy_pack(units: Sequence[str], joiner: str = " ") -> list[str]:
    """Жадібно пакує одиниці у блоки не довші за MAX_CHARS."""
    packed: list[str] = []
    buffer: list[str] = []

    for unit in units:
        proposed = joiner.join([*buffer, unit]).strip()
        if buffer and len(proposed) > MAX_CHARS:
            packed.append(joiner.join(buffer).strip())
            buffer = [unit]
        else:
            buffer.append(unit)

    if buffer:
        packed.append(joiner.join(buffer).strip())

    # Якщо останній блок надто короткий, намагаємося приєднати його до попереднього.
    if len(packed) >= 2 and len(packed[-1]) < MIN_CHARS:
        merged = f"{packed[-2]}{joiner}{packed[-1]}".strip()
        if len(merged) <= MAX_CHARS:
            packed[-2:] = [merged]

    return packed


def split_long_group(lines: Sequence[str]) -> list[str]:
    """Розбиває строфу >150 символів на логічні блоки."""
    cleaned = [line for line in lines if line]
    if not cleaned:
        return []

    # Спочатку намагаємося зберегти цілі поетичні рядки.
    chunks = greedy_pack(cleaned)
    result: list[str] = []

    for chunk in chunks:
        if len(chunk) <= MAX_CHARS:
            if len(chunk) >= MIN_CHARS:
                result.append(chunk)
            continue

        # Якщо один поетичний рядок наддовгий — ділимо за пунктуацією.
        by_sentence = greedy_pack(sentence_units(chunk))
        for sentence_chunk in by_sentence:
            if MIN_CHARS <= len(sentence_chunk) <= MAX_CHARS:
                result.append(sentence_chunk)
            elif len(sentence_chunk) > MAX_CHARS:
                # Крайній випадок: ділення за словами.
                for word_chunk in greedy_pack(word_units(sentence_chunk)):
                    if MIN_CHARS <= len(word_chunk) <= MAX_CHARS:
                        result.append(word_chunk)

    return result


def parse_stanza_groups(raw_text: str) -> list[list[str]]:
    """Перетворює сирий текст на список строф (списків рядків)."""
    groups: list[list[str]] = []

    for raw_group in re.split(r"\n\s*\n", raw_text):
        lines: list[str] = []
        for raw_line in raw_group.splitlines():
            line = clean_line(raw_line)
            if is_noise_line(line):
                continue
            lines.append(line)

        if lines:
            groups.append(lines)

    return groups


def fit_groups_to_limits(groups: Sequence[Sequence[str]]) -> list[str]:
    """Дає блоки зі строгою довжиною 60–150 символів."""
    result: list[str] = []
    short_buffer: list[str] = []

    def flush_short_buffer() -> None:
        nonlocal short_buffer
        text = one_line(short_buffer)
        if MIN_CHARS <= len(text) <= MAX_CHARS:
            result.append(text)
        short_buffer = []

    for group in groups:
        lines = [clean_line(line) for line in group if clean_line(line)]
        text = one_line(lines)
        if not text:
            continue

        if len(text) > MAX_CHARS:
            flush_short_buffer()
            result.extend(split_long_group(lines))
            continue

        if len(text) < MIN_CHARS:
            proposed = one_line([*short_buffer, *lines])
            if short_buffer and len(proposed) > MAX_CHARS:
                flush_short_buffer()
            short_buffer.extend(lines)
            if MIN_CHARS <= len(one_line(short_buffer)) <= MAX_CHARS:
                flush_short_buffer()
            continue

        # Поточна строфа вже має допустиму довжину.
        if short_buffer:
            combined = one_line([*short_buffer, *lines])
            if len(combined) <= MAX_CHARS:
                result.append(combined)
                short_buffer = []
                continue
            flush_short_buffer()

        result.append(text)

    flush_short_buffer()
    return [text for text in result if looks_like_ukrainian_poetry(text)]


def extract_stanzas(html: str) -> list[str]:
    all_stanzas: list[str] = []
    for raw_text in extract_raw_poem_texts(html):
        groups = parse_stanza_groups(raw_text)
        all_stanzas.extend(fit_groups_to_limits(groups))

    # Дедуплікація зі збереженням порядку.
    seen: set[str] = set()
    unique: list[str] = []
    for stanza in all_stanzas:
        key = normalize_for_match(stanza)
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(stanza)
    return unique


# ---------------------------------------------------------------------------
# Популярність та рейтинг строф
# ---------------------------------------------------------------------------


def get_pageviews(
    session: requests.Session,
    page_title: str,
    days: int = DEFAULT_PAGEVIEW_DAYS,
) -> int:
    """Сумарні перегляди сторінки за останні N завершених днів."""
    if days <= 0:
        return 0

    end_date = datetime.now(timezone.utc).date() - timedelta(days=2)
    start_date = end_date - timedelta(days=days - 1)
    article = quote(page_title.replace(" ", "_"), safe="")
    url = (
        f"{PAGEVIEWS_BASE}/{WIKIMEDIA_PROJECT}/all-access/user/"
        f"{article}/daily/{start_date:%Y%m%d}00/{end_date:%Y%m%d}00"
    )

    try:
        data = request_json(session, url, delay=REQUEST_DELAY_SECONDS)
    except RuntimeError as exc:
        logging.info("Немає Pageviews для %s: %s", page_title, exc)
        return 0

    items = data.get("items", [])
    return sum(int(item.get("views", 0)) for item in items if isinstance(item, dict))


def normalized_contains(text: str, fragment: str) -> bool:
    return normalize_for_match(fragment) in normalize_for_match(text)


def stanza_score(
    stanza: str,
    *,
    index: int,
    total: int,
    pageviews: int,
    famous_fragments: Sequence[str],
) -> float:
    """Оцінка: популярність твору + відомі фрагменти + читабельність блоку."""
    score = math.log1p(max(pageviews, 0)) * 8.0

    for fragment in famous_fragments:
        if normalized_contains(stanza, fragment):
            score += 120.0

    # Початок і фінал вірша частіше є впізнаваними завершеними фрагментами.
    if index == 0:
        score += 24.0
    elif index == 1:
        score += 10.0
    if total > 1 and index == total - 1:
        score += 14.0

    # Для екрана мобільної гри середина дозволеного діапазону зручніша.
    target_length = 105
    score += max(0.0, 12.0 - abs(len(stanza) - target_length) / 5.0)

    # Невеликий бонус завершеним фразам.
    if stanza.endswith((".", "!", "?", "…", "»")):
        score += 4.0
    if any(mark in stanza for mark in ("—", ":", ";")):
        score += 2.0

    return score


# ---------------------------------------------------------------------------
# Основний конвеєр
# ---------------------------------------------------------------------------


def collect_candidates(
    session: requests.Session,
    seeds: Sequence[WorkSeed],
    *,
    per_work: int,
    pageview_days: int,
    use_pageviews: bool,
) -> list[Candidate]:
    candidates: list[Candidate] = []
    resolved_pages: set[str] = set()

    for work_number, seed in enumerate(seeds, start=1):
        logging.info(
            "[%d/%d] %s — «%s»",
            work_number,
            len(seeds),
            seed.author,
            seed.title,
        )

        try:
            resolved = search_work(session, seed)
            if resolved is None:
                continue

            page_key = normalize_for_match(resolved.page_title)
            if page_key in resolved_pages:
                logging.info("Сторінку вже оброблено: %s", resolved.page_title)
                continue
            resolved_pages.add(page_key)

            actual_title, html = fetch_rendered_page(session, resolved.page_title)
            actual_url = WIKISOURCE_BASE + quote(
                actual_title.replace(" ", "_"), safe="/()!,'"
            )
            stanzas = extract_stanzas(html)
            if not stanzas:
                logging.warning("Не знайдено придатних строф: %s", actual_title)
                continue

            pageviews = (
                get_pageviews(session, actual_title, pageview_days)
                if use_pageviews
                else 0
            )
            source = f"{seed.author} — «{seed.title}» | {actual_url}"

            ranked_for_work: list[Candidate] = []
            for index, stanza in enumerate(stanzas):
                score = stanza_score(
                    stanza,
                    index=index,
                    total=len(stanzas),
                    pageviews=pageviews,
                    famous_fragments=seed.famous_fragments,
                )
                ranked_for_work.append(
                    Candidate(
                        text=stanza,
                        source=source,
                        author=seed.author,
                        title=seed.title,
                        page_title=actual_title,
                        pageviews=pageviews,
                        score=score,
                        order=index,
                    )
                )

            ranked_for_work.sort(key=lambda item: (-item.score, item.order))
            candidates.extend(ranked_for_work[: max(1, per_work)])

            logging.info(
                "  знайдено %d строф, відібрано %d, переглядів: %d",
                len(stanzas),
                min(len(ranked_for_work), max(1, per_work)),
                pageviews,
            )

        except (RuntimeError, KeyError, TypeError, ValueError) as exc:
            logging.error(
                "Не вдалося обробити %s — «%s»: %s",
                seed.author,
                seed.title,
                exc,
            )
            continue
        except Exception as exc:  # страховка: один твір не зупиняє весь збір
            logging.exception(
                "Неочікувана помилка для %s — «%s»: %s",
                seed.author,
                seed.title,
                exc,
            )
            continue

    return candidates


def deduplicate_candidates(candidates: Iterable[Candidate]) -> list[Candidate]:
    """Видаляє точні та майже однакові тексти, залишаючи вищий рейтинг."""
    ordered = sorted(candidates, key=lambda item: (-item.score, item.author, item.title))
    accepted: list[Candidate] = []
    normalized_accepted: list[str] = []

    for candidate in ordered:
        normalized = normalize_for_match(candidate.text)
        duplicate = False

        for existing in normalized_accepted:
            if normalized == existing:
                duplicate = True
                break
            # Прибираємо випадки, де один блок майже повністю дублює інший.
            shorter, longer = sorted((normalized, existing), key=len)
            if len(shorter) >= 45 and shorter in longer:
                duplicate = True
                break
            if SequenceMatcher(None, normalized, existing).ratio() >= 0.94:
                duplicate = True
                break

        if not duplicate:
            accepted.append(candidate)
            normalized_accepted.append(normalized)

    return accepted


def build_output(candidates: Sequence[Candidate], limit: int) -> list[dict[str, str]]:
    final_candidates = deduplicate_candidates(candidates)
    final_candidates.sort(
        key=lambda item: (-item.score, item.author, item.title, item.order)
    )

    if limit > 0:
        final_candidates = final_candidates[:limit]

    return [
        {
            "text": item.text,
            "source": item.source,
        }
        for item in final_candidates
    ]


def save_json(items: Sequence[dict[str, str]], output_path: Path) -> None:
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", encoding="utf-8") as file:
            json.dump(items, file, ensure_ascii=False, indent=2)
            file.write("\n")
    except OSError as exc:
        raise RuntimeError(f"Не вдалося записати {output_path}: {exc}") from exc


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Збирає строфи української класичної поезії з Вікіджерел "
            "та записує JSON для гри «Криптограма»."
        )
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT,
        help=f"Шлях до JSON-файлу (типово: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help=(
            "Максимальна кількість об'єктів у результаті; "
            "0 означає без глобального ліміту"
        ),
    )
    parser.add_argument(
        "--per-work",
        type=int,
        default=DEFAULT_PER_WORK,
        help="Скільки найкращих строф брати з одного твору",
    )
    parser.add_argument(
        "--pageview-days",
        type=int,
        default=DEFAULT_PAGEVIEW_DAYS,
        help="За скільки останніх днів рахувати перегляди твору",
    )
    parser.add_argument(
        "--no-pageviews",
        action="store_true",
        help="Не звертатися до Pageviews API; швидше, але без рейтингу популярності",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Показувати докладні повідомлення",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)

    if args.limit < 0:
        print("Помилка: --limit не може бути від'ємним", file=sys.stderr)
        return 2
    if args.per_work < 1:
        print("Помилка: --per-work має бути не менше 1", file=sys.stderr)
        return 2
    if args.pageview_days < 1 and not args.no_pageviews:
        print("Помилка: --pageview-days має бути не менше 1", file=sys.stderr)
        return 2

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )

    output_path = Path(args.output)
    session = build_session()

    try:
        candidates = collect_candidates(
            session,
            SEED_WORKS,
            per_work=args.per_work,
            pageview_days=args.pageview_days,
            use_pageviews=not args.no_pageviews,
        )
        output = build_output(candidates, args.limit)
        save_json(output, output_path)
    except KeyboardInterrupt:
        logging.warning("Зупинено користувачем")
        return 130
    except RuntimeError as exc:
        logging.error("Критична помилка: %s", exc)
        return 1
    finally:
        session.close()

    logging.info("Готово: %d об'єктів записано у %s", len(output), output_path)
    if not output:
        logging.warning(
            "Файл порожній. Перевірте інтернет-з'єднання або запустіть із --verbose."
        )
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
