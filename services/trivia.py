import html
import httpx
import random
import asyncio
from deep_translator import GoogleTranslator

CATEGORIES = {
    "any": "",          
    "geral": 9, "games": 15, "animes": 31, "computadores": 18, 
    "matematica": 19, "historia": 23, "geografia": 22, 
    "ciencias": 17, "filmes": 11
}

COMMON_TRANSLATIONS = {
    "Red": "Vermelho", "Blue": "Azul", "Green": "Verde", "Yellow": "Amarelo",
    "Black": "Preto", "White": "Branco", "Orange": "Laranja", "Purple": "Roxo",
    "Pink": "Rosa", "Grey": "Cinza", "Gray": "Cinza", "Brown": "Marrom",
    "True": "Verdadeiro", "False": "Falso", "None": "Nenhum", "All of the above": "Todas as anteriores"
}

def should_use_google_translate(category_name):
    forbidden_keywords = [
        "Anime", "Manga", "Music", "Video Game", "Film", "Movie", 
        "Television", "Cartoon", "Comic", "Band", "Musical", "Theatre"
    ]
    for keyword in forbidden_keywords:
        if keyword in category_name:
            return False 
    return True 

def _sync_translate(text, target='pt'):
    try:
        return GoogleTranslator(source='auto', target=target).translate(text)
    except Exception:
        return text

async def smart_translate(text, use_google=True):
    text_clean = text.strip()

    if text_clean in COMMON_TRANSLATIONS:
        return COMMON_TRANSLATIONS[text_clean]

    if use_google:
        return await asyncio.to_thread(_sync_translate, text_clean)
            
    return text

async def get_trivia_question(category_key="any"):
    last_error = ""
    cat_id = CATEGORIES.get(category_key, "")
    base_url = "https://opentdb.com/api.php?amount=1&type=multiple"
    if cat_id:
        base_url += f"&category={cat_id}"

    for attempt in range(1, 4):
        try:
            print(f"🔄 Tentativa {attempt} [{category_key}]...", flush=True)
            
            async with httpx.AsyncClient() as client:
                resp = await client.get(base_url, timeout=10.0)
                resp.raise_for_status() 
                data = resp.json()
            
            if data["response_code"] != 0:
                last_error = f"API recusou (Code {data['response_code']})"
                await asyncio.sleep(1)
                continue

            item = data["results"][0]
            category_raw = item["category"]
            
            pergunta_en = html.unescape(item["question"])
            correct_en = html.unescape(item["correct_answer"])
            wrong_ens = [html.unescape(w) for w in item["incorrect_answers"]]

            allow_google_opts = should_use_google_translate(category_raw)

            pergunta_pt = await smart_translate(pergunta_en, use_google=True)
            correct_final = await smart_translate(correct_en, use_google=allow_google_opts)

            tasks = [smart_translate(w, use_google=allow_google_opts) for w in wrong_ens]
            wrong_finals = await asyncio.gather(*tasks)
            
            all_options = wrong_finals + [correct_final]
            random.shuffle(all_options)
            correct_idx = all_options.index(correct_final)
            
            return {
                "q": pergunta_pt, 
                "options": all_options,
                "correct_idx": correct_idx
            }

        except Exception as e:
            last_error = f"Erro: {str(e)}"
            print(f"❌ {last_error}", flush=True)
            await asyncio.sleep(1)

    return {"error": last_error or "Falha após 3 tentativas"}