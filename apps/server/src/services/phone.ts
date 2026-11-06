/**
 * Номер телефона аккаунта Telegram → «+<код страны><номер>» или null, если номер не разобрать.
 * Копия лежит в apps/webapp/src/phone.ts: кнопка «Оформить» и сервер должны понимать номер одинаково
 * (тест в test/unit.test.ts гоняет обе копии по одному набору).
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v || /[^\d\s()+\-.]/.test(v)) return null;
  const digits = v.replace(/\D/g, '');
  if (v.startsWith('+')) {
    // «+8 9…» и «+8 7…» — опечатка вместо +7: кодов стран, с которых начинались бы такие 11 цифр, нет
    if (digits.length === 11 && /^8[79]/.test(digits)) return '+7' + digits.slice(1);
    // Кода страны 89 нет: это та же опечатка, но с лишней или пропущенной цифрой
    if (digits.startsWith('89')) return null;
    // у России с Казахстаном и у Украины длина номера известна: лишняя или пропущенная цифра — ошибка
    if (digits.startsWith('7') && digits.length !== 11) return null;
    if (digits.startsWith('380') && digits.length !== 12) return null;
    return /^[1-9]\d{7,14}$/.test(digits) ? '+' + digits : null;
  }
  // Без «+»: местные форматы России, Казахстана и Украины
  if (digits.length === 11 && digits.startsWith('7')) return '+' + digits;
  if (digits.length === 11 && /^8[79]/.test(digits)) return '+7' + digits.slice(1); // 8 900…, 8 701…
  if (digits.length === 10 && /^[79]/.test(digits)) return '+7' + digits; // 900 123-45-67
  if (digits.length === 10 && digits.startsWith('0')) return '+38' + digits; // 067 123 45 67
  // Остальное считаем международным номером без «+», кроме 11 цифр на 8: это может быть и Вьетнам, и городской номер.
  // Проверки длины те же, что с «+»: 7 900 123 45 678 и 380 67 123 45 6 — ошибки, а не чужие страны
  if (digits.length >= 11 && digits.length <= 15 && !/^[08]/.test(digits)) return normalizePhone('+' + digits);
  return null;
}
