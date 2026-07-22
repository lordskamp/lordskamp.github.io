import json
import re
import requests
from bs4 import BeautifulSoup


def clean_and_format_segment(text: str) -> str:
    """Очищає текст від зайвих переносів, пробілів та сміття."""
    text = text.replace("\n", " ").replace("\r", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def parse_ukrlib_free(url: str, author: str, title: str) -> list:
    """Безкоштовно викачує вірш та самостійно нарізає його на строфи."""
    print(f"Парсинг твору: {title} ({url})...")
    quotes = []

    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        response = requests.get(url, headers=headers)
        response.encoding = "utf-8"

        soup = BeautifulSoup(response.text, "html.parser")

        # Шукаємо блок з текстом твору
        text_container = soup.find(["div", "article"], class_=["text", "poem"])
        if not text_container:
            text_container = soup.find("body")

        # Перетворюємо <br> на переноси рядків для точного розподілу
        for br in text_container.find_all("br"):
            br.replace_with("\n")

        raw_text = text_container.get_text()

        # Фільтруємо пусті рядки
        lines = [line.strip() for line in raw_text.split("\n") if line.strip()]

        # Масштабована нарізка: перевіряємо комбінації з різною кількістю рядків
        # Це допомагає адаптуватися і під класичний вірш, і під стиль Жадана
        for chunk_size in [2, 3, 4]:
            for i in range(0, len(lines) - chunk_size + 1):
                chunk = " ".join(lines[i : i + chunk_size])
                cleaned_chunk = clean_and_format_segment(chunk)

                # Перевірка лімітів (60-150 символів) та відсікання технічного сміття сайту
                if (
                    60 <= len(cleaned_chunk) <= 150
                    and "укрліб" not in cleaned_chunk.lower()
                    and "бібліотека" not in cleaned_chunk.lower()
                    and "читати" not in cleaned_chunk.lower()
                ):

                    source_string = f"{author} — «{title}» | {url}"

                    if not any(q["text"] == cleaned_chunk for q in quotes):
                        quotes.append({"text": cleaned_chunk, "source": source_string})

    except Exception as e:
        print(f"Помилка при обробці {title}: {e}")

    return quotes


# ==========================================
# ГОЛОВНИЙ БЛОК ДЛЯ МАСОВОГО ЗАПУСКУ
# ==========================================
if __name__ == "__main__":
    # Сюди додано пул класиків + сучасна поезія Сергія Жадана
    urls_to_process = [
        # --- СУЧАСНА ПОЕЗІЯ (СЕРГІЙ ЖАДАН) ---
        {
            "url": "https://www.ukrlib.com.ua/books/printit.php?tid=14091",
            "author": "Сергій Жадан",
            "title": "Жінки",
        },
        {
            "url": "https://www.ukrlib.com.ua/books/printit.php?tid=13039",
            "author": "Сергій Жадан",
            "title": "Музика, очерет",
        },
        {
            "url": "https://www.ukrlib.com.ua/books/printit.php?tid=14088",
            "author": "Сергій Жадан",
            "title": "І жінка з чорним, як земля, волоссям...",
        },
        {
            "url": "https://www.ukrlib.com.ua/books/printit.php?tid=14084",
            "author": "Сергій Жадан",
            "title": "Можливо, я просто не вмію передати все це…",
        },
        # --- КЛАСИКА ---
        {
            "url": "https://ukrlib.com.ua",
            "author": "Леся Українка",
            "title": "Contra spem spero!",
        },
        {
            "url": "https://ukrlib.com.ua",
            "author": "Іван Франко",
            "title": "Каменярі",
        },
        {
            "url": "https://ukrlib.com.ua",
            "author": "Тарас Шевченко",
            "title": "Кавказ",
        },
    ]

    all_cryptograms = []

    for item in urls_to_process:
        quotes = parse_ukrlib_free(item["url"], item["author"], item["title"])
        all_cryptograms.extend(quotes)
        print(f"Додано {len(quotes)} валідних строф.")

    # Збереження результату
    output_filename = "free_cryptograms_with_zhadan.json"
    with open(output_filename, "w", encoding="utf-8") as f:
        json.dump(all_cryptograms, f, ensure_ascii=False, indent=2)

    print(
        f"\nУспішно! Згенеровано базу з {len(all_cryptograms)} цитат у файл {output_filename}"
    )
