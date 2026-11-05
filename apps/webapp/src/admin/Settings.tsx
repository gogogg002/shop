import { useEffect, useState } from 'react';
import { api, methodLabel, type Method } from '../api';
import { Toggle, useLoad, useToast } from '../ui/kit';

interface S {
  methods: Record<Method, boolean>;
  fees: Record<Method, number>;
  uah: { card: string; holder: string; bank: string; rate: number };
  sbp: { phone: string; holder: string; bank: string };
  usdtRate: number;
  paymentTtlMin: number;
  slaMin: number;
  supportUsername: string;
}

const ORDER: Method[] = ['SBP', 'CRYPTOBOT', 'XROCKET', 'LOLZ', 'UAH'];

export function Settings() {
  const { data } = useLoad(() => api<S>('/api/admin/settings'));
  const [s, setS] = useState<S | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { if (data && !s) setS(data); }, [data, s]);
  if (!s) return <div className="page"><div className="skeleton" style={{ height: 300 }} /></div>;

  const num = (v: string) => Number(v.replace(',', '.')) || 0;

  async function save() {
    setBusy(true);
    try {
      setS(await api<S>('/api/admin/settings', { method: 'PATCH', body: s }));
      toast('Настройки сохранены');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="glow" />
      <h1 className="disp" style={{ fontSize: 34 }}>Настройки</h1>

      <div className="cap">Способы оплаты</div>
      <div className="card list">
        {ORDER.map((m) => (
          <div key={m} className="row item">
            <div className="sp"><div style={{ fontWeight: 600 }}>{methodLabel[m].title}</div><div className="muted small">{methodLabel[m].sub}</div></div>
            <label className="field" style={{ width: 76, padding: "4px 10px" }}><span>Наценка</span>
              <input inputMode="decimal" value={s.fees[m]} onChange={(e) => setS({ ...s, fees: { ...s.fees, [m]: num(e.target.value) } })} />
            </label>
            <Toggle on={s.methods[m]} onChange={(v) => setS({ ...s, methods: { ...s.methods, [m]: v } })} label={`Включить ${methodLabel[m].title}`} />
          </div>
        ))}
      </div>
      <p className="muted small">CryptoBot, xRocket и Lolz заработают, когда на сервере прописаны их токены. Гривны и СБП появятся у клиента, когда ниже заполнены реквизиты.</p>

      <div className="cap">Гривны: куда переводить</div>
      <label className="field"><span>Номер карты</span><input className="mono" value={s.uah.card} onChange={(e) => setS({ ...s, uah: { ...s.uah, card: e.target.value } })} placeholder="4441 1111 2222 3333" /></label>
      <div className="row" style={{ gap: 8 }}>
        <label className="field sp"><span>Получатель</span><input value={s.uah.holder} onChange={(e) => setS({ ...s, uah: { ...s.uah, holder: e.target.value } })} /></label>
        <label className="field sp"><span>Банк</span><input value={s.uah.bank} onChange={(e) => setS({ ...s, uah: { ...s.uah, bank: e.target.value } })} placeholder="monobank" /></label>
      </div>
      <label className="field"><span>Курс: сколько ₽ стоит 1 грн</span><input inputMode="decimal" value={s.uah.rate} onChange={(e) => setS({ ...s, uah: { ...s.uah, rate: num(e.target.value) } })} /></label>

      <div className="cap">СБП вручную (пока нет агрегатора)</div>
      <label className="field"><span>Телефон</span><input value={s.sbp.phone} onChange={(e) => setS({ ...s, sbp: { ...s.sbp, phone: e.target.value } })} placeholder="+7 900 000-00-00" /></label>
      <div className="row" style={{ gap: 8 }}>
        <label className="field sp"><span>Получатель</span><input value={s.sbp.holder} onChange={(e) => setS({ ...s, sbp: { ...s.sbp, holder: e.target.value } })} /></label>
        <label className="field sp"><span>Банк</span><input value={s.sbp.bank} onChange={(e) => setS({ ...s, sbp: { ...s.sbp, bank: e.target.value } })} /></label>
      </div>

      <div className="cap">Прочее</div>
      <div className="row" style={{ gap: 8 }}>
        <label className="field sp"><span>Курс USDT, ₽</span><input inputMode="decimal" value={s.usdtRate} onChange={(e) => setS({ ...s, usdtRate: num(e.target.value) })} /></label>
        <label className="field sp"><span>SLA выдачи, мин</span><input inputMode="numeric" value={s.slaMin} onChange={(e) => setS({ ...s, slaMin: num(e.target.value) })} /></label>
      </div>
      <label className="field"><span>Username поддержки</span><input value={s.supportUsername} onChange={(e) => setS({ ...s, supportUsername: e.target.value })} placeholder="@support" /></label>

      <button className="btn block" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить настройки'}</button>
    </div>
  );
}
