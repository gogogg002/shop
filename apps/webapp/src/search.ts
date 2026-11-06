/**
 * Поиск по витрине на русском и английском: «теле», «тг», «звёзды», «стим», «дискорд», «гпт» находят нужный сервис.
 * Строка товара дополняется транслитом и русскими синонимами, запрос сравнивается и как есть, и в транслите.
 */

const RU_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

/** Русские названия и сокращения, по которым люди ищут сервисы */
const SYNONYMS: [RegExp, string][] = [
  [/telegram/i, 'телеграм телеграмм телега тг tg телеграмм'],
  [/premium/i, 'премиум прем премка'],
  [/stars/i, 'звезды звёзды звездочки старс'],
  [/discord/i, 'дискорд дс ds'],
  [/nitro/i, 'нитро'],
  [/steam/i, 'стим пополнение игры'],
  [/chatgpt|gpt/i, 'чатгпт чат гпт гпт жпт openai опенаи нейросеть нейронка'],
];

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const translit = (s: string) => [...s].map((ch) => RU_LAT[ch] ?? ch).join('');

/** Всё, по чему товар можно найти, одной строкой */
export function searchText(...parts: string[]) {
  const base = norm(parts.join(' '));
  const extra = SYNONYMS.filter(([re]) => re.test(base)).map(([, words]) => words).join(' ');
  const all = norm(`${base} ${extra}`);
  return `${all} ${translit(all)}`;
}

export function matches(haystack: string, query: string) {
  const q = norm(query);
  if (!q) return true;
  // Каждое слово запроса должно найтись: «тг премиум» → Telegram Premium
  return q.split(' ').every((w) => haystack.includes(w) || haystack.includes(translit(w)));
}
