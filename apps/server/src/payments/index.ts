import type { PaymentMethod } from '@prisma/client';
import { cryptobot } from './cryptobot.js';
import { xrocket } from './xrocket.js';
import type { AutoProvider } from './types.js';

/** Методы с автоматическим подтверждением */
export const autoProviders: Partial<Record<PaymentMethod, AutoProvider>> = {
  CRYPTOBOT: cryptobot,
  XROCKET: xrocket,
  // LOLZ и SBP-агрегатор подключаются сюда же, когда будут токены
};

/** Методы, где клиент переводит сам, а админ подтверждает по чеку */
export const manualMethods: PaymentMethod[] = ['UAH', 'SBP'];

export const isManual = (m: PaymentMethod) => manualMethods.includes(m);
