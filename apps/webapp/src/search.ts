/**
 * Поиск по витрине на русском и английском: «теле», «тг», «звезду», «стим», «дискорд», «гпт», «подарок» находят
 * нужный сервис. Строка товара дополняется русскими синонимами и транслитом. Слово запроса ищется по началу слов
 * товара («тг» не находит ChatGPT), а русское слово ещё и без окончания («звезду» находит «звезды»).
 */

const RU_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

/** Русские названия и сокращения, по которым люди ищут сервисы */
const SYNONYMS: [RegExp, string][] = [
  [/telegram/, 'телеграм телеграмм телега тг tg'],
  [/premium/, 'премиум прем премка подписка'],
  [/stars/, 'звезды звездочки старс'],
  [/подарк/, 'подарок подарить подарочный gift'],
  [/discord/, 'дискорд дс ds'],
  [/nitro/, 'нитро'],
  [/steam/, 'стим пополнение пополнить кошелек игры'],
  [/chatgpt|gpt/, 'чатгпт чат гпт жпт openai опенаи ai аи open опен нейросеть нейронка нейро сеть'],
  [/claude/, 'клод клауд клауде клоуд anthropic антропик ai аи нейросеть нейронка нейро'],
  [/plus/, 'плюс'],
];

/** Слова строки: в нижнем регистре, «ё» как «е», без знаков («телеграм-премиум» — два слова) */
const words = (s: string) => s.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter(Boolean);
const translit = (w: string) => [...w].map((ch) => RU_LAT[ch] ?? ch).join('');
/** Русское слово без окончания: «звезду» → «звезд», «стима» → «стим». Короче четырёх букв не режем */
const stems = (w: string) => (/[а-я]/.test(w) && w.length >= 5 ? [w.slice(0, -1), w.slice(0, -2)].filter((s) => s.length >= 4) : []);

/** Всё, по чему товар можно найти: слова через пробел */
export function searchText(...parts: string[]) {
  const base = words(parts.join(' '));
  const joined = base.join(' ');
  const extra = SYNONYMS.filter(([re]) => re.test(joined)).flatMap(([, list]) => words(list));
  const all = [...base, ...extra];
  return [...new Set([...all, ...all.map(translit)])].join(' ');
}

export function matches(haystack: string, query: string) {
  const q = words(query);
  if (!q.length) return true;
  const tokens = haystack.split(' ');
  // Каждое слово запроса должно найтись: «тг премиум» → Telegram Premium
  return q.every((w) => {
    const forms = [w, translit(w), ...stems(w)];
    return tokens.some((t) => forms.some((f) => t.startsWith(f)));
  });
}
