/**
 * Быстрые метки отзыва. Хранятся в самом тексте отзыва: «Быстро, Честная цена. Свой текст».
 * Разбор и сборка взаимно обратны, поэтому при правке метки восстанавливаются, а неизменённый отзыв не считается правкой.
 */
export const TAGS = ['Быстро', 'Честная цена', 'Поддержка помогла'];
export const TEXT_MAX = 1000;
export const TAGS_ROOM = TAGS.join(', ').length + 2;

export function splitTags(saved: string): { tags: string[]; rest: string } {
  const cut = saved.indexOf('. ');
  const head = cut >= 0 ? saved.slice(0, cut) : saved;
  const items = head.split(', ');
  if (head && items.every((t) => TAGS.includes(t)) && new Set(items).size === items.length) {
    return { tags: items, rest: cut >= 0 ? saved.slice(cut + 2) : '' };
  }
  return { tags: [], rest: saved };
}
export const joinTags = (tags: string[], rest: string) => [tags.join(', '), rest.trim()].filter(Boolean).join('. ');
