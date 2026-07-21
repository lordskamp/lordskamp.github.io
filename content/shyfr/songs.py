import json
import re
from spotipy import Spotify
from spotipy.oauth2 import SpotifyClientCredentials
import lyricsgenius

# 1. Налаштування ключів API
SPOTIPY_CLIENT_ID = 'f72a71f006e244cb87b4f3887bec0a54'
SPOTIPY_CLIENT_SECRET = '2b206f638a9b49819cbb4cfa69c29d47'
GENIUS_TOKEN = 'GBUL_z7_h5U3XSYc5QOM1ZvgnNMjJVqwM1PGUbi0g6PgbhEdzIicBj2iSzH8urjs'

# 2. Ініціалізація клієнтів
sp = Spotify(auth_manager=SpotifyClientCredentials(
    client_id=SPOTIPY_CLIENT_ID,
    client_secret=SPOTIPY_CLIENT_SECRET
))

genius = lyricsgenius.Genius(GENIUS_TOKEN)
genius.verbose = False  # Вимикаємо зайвий лог у консолі
genius.remove_section_headers = False  # Залишаємо теги типу [Chorus] для пошуку

PLAYLIST_ID = '1IoanWYXz1mT8ZLjYpP34W'  # ID вашого плейліста

def extract_chorus(lyrics_text):
    """
    Витягує тільки перший приспів із тексту пісні.
    Шукає блоки [Chorus], [Приспів] тощо.
    """
    if not lyrics_text:
        return None
    
    # Регулярний вираз для пошуку блоку приспіву
    pattern = r'\[(?:Chorus|Приспів)[^\]]*\]\n(.*?)(?=\n\[|\Z)'
    match = re.search(pattern, lyrics_text, re.DOTALL | re.IGNORECASE)
    
    if match:
        chorus_text = match.group(1).strip()
        # Очищаємо від зайвих метаданих Genius у кінці (наприклад, "123Embed")
        chorus_text = re.sub(r'\d*Embed$', '', chorus_text).strip()
        return chorus_text
    
    return None

def process_playlist(playlist_id):
    results = sp.playlist_items(playlist_id)
    dataset = []

    for item in results['items']:
        track = item['track']
        if not track:
            continue
            
        track_name = track['name']
        artist_name = track['artists'][0]['name']
        spotify_url = track['external_urls']['spotify']

        print(f"Обробка: {artist_name} - {track_name}...")

        # Пошук тексту на Genius
        try:
            song = genius.search_song(track_name, artist_name)
            if song and song.lyrics:
                chorus = extract_chorus(song.lyrics)
                if chorus:
                    dataset.append({
                        "text": chorus,
                        "source": spotify_url
                    })
                    print("  --> Приспів знайдено!")
                else:
                    print("  --> Текст знайдено, але блок приспіву [Chorus/Приспів] не виявлено.")
            else:
                print("  --> Текст не знайдено на Genius.")
        except Exception as e:
            print(f"  --> Помилка при пошуку: {e}")

    # Збереження у файл JSON
    with open('choruses.json', 'w', encoding='utf-8') as f:
        json.dump(dataset, f, ensure_ascii=False, indent=2)

    print(f"\nГотово! Збережено {len(dataset)} приспівів у файл choruses.json")

if __name__ == '__main__':
    process_playlist(PLAYLIST_ID)