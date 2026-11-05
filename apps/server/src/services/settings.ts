import { prisma } from '../db.js';

export interface ShopSettings {
  /** Какие методы оплаты показываются клиенту */
  methods: Record<'CRYPTOBOT' | 'XROCKET' | 'LOLZ' | 'SBP' | 'UAH', boolean>;
  /** Наценка метода в процентах (комиссия провайдера) */
  fees: Record<'CRYPTOBOT' | 'XROCKET' | 'LOLZ' | 'SBP' | 'UAH', number>;
  /** Реквизиты для ручной оплаты гривнами */
  uah: { card: string; holder: string; bank: string; rate: number /* ₽ за 1 грн */ };
  /** Реквизиты для ручной СБП, пока нет агрегатора */
  sbp: { phone: string; holder: string; bank: string };
  /** Курс для xRocket: ₽ за 1 USDT */
  usdtRate: number;
  /** Срок на оплату заказа, минут */
  paymentTtlMin: number;
  /** SLA выдачи, минут (для таймеров в админке) */
  slaMin: number;
  supportUsername: string;
}

export const defaultSettings: ShopSettings = {
  methods: { CRYPTOBOT: true, XROCKET: true, LOLZ: false, SBP: false, UAH: true },
  fees: { CRYPTOBOT: 3, XROCKET: 1, LOLZ: 0, SBP: 0, UAH: 0 },
  uah: { card: '', holder: '', bank: '', rate: 2.35 },
  sbp: { phone: '', holder: '', bank: '' },
  usdtRate: 95,
  paymentTtlMin: 30,
  slaMin: 30,
  supportUsername: '',
};

const KEY = 'shop';

export async function getSettings(): Promise<ShopSettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const v = (row?.value ?? {}) as Partial<ShopSettings>;
  return {
    ...defaultSettings,
    ...v,
    methods: { ...defaultSettings.methods, ...(v.methods ?? {}) },
    fees: { ...defaultSettings.fees, ...(v.fees ?? {}) },
    uah: { ...defaultSettings.uah, ...(v.uah ?? {}) },
    sbp: { ...defaultSettings.sbp, ...(v.sbp ?? {}) },
  };
}

export async function saveSettings(patch: Partial<ShopSettings>): Promise<ShopSettings> {
  const cur = await getSettings();
  const next: ShopSettings = {
    ...cur,
    ...patch,
    methods: { ...cur.methods, ...(patch.methods ?? {}) },
    fees: { ...cur.fees, ...(patch.fees ?? {}) },
    uah: { ...cur.uah, ...(patch.uah ?? {}) },
    sbp: { ...cur.sbp, ...(patch.sbp ?? {}) },
  };
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: next as object },
    update: { value: next as object },
  });
  return next;
}
