import { useEffect, useState } from 'react';
import { api, rub, statusLabel, type AdminOrder } from '../api';
import { Icon, Key, useLoad, useToast } from '../ui/kit';

interface Summary { revenue: number; profit: number; orders: number; queue: number; hourly: number[]; lowStock: { variantId: number; title: string; left: number }[]; slaMin: number }

const FILTERS = [
  ['queue', 'Очередь'],
  ['PENDING_PAYMENT', 'Ждут оплаты'],
  ['DELIVERED', 'Выданы'],
  ['REJECTED', 'Отклонены'],
  ['', 'Все'],
] as const;

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(h);
  }, [ms]);
  return now;
}

/** Таймер с момента оплаты: жёлтый за 10 минут до SLA, красный после */
function Timer({ from, sla }: { from: string; sla: number }) {
  const now = useNow();
  const sec = Math.max(0, Math.floor((now - new Date(from).getTime()) / 1000));
  const tone = sec > sla * 60 ? 'bad' : sec > (sla - 10) * 60 ? 'warn' : 'm';
  return <span className={`pill ${tone} mono`}>{String(Math.floor(sec / 60)).padStart(2, '0')}:{String(sec % 60).padStart(2, '0')}</span>;
}

export function Dashboard({ queueOnly }: { queueOnly: boolean }) {
  const toast = useToast();
  const [filter, setFilter] = useState<string>('queue');
  const summary = useLoad(() => api<Summary>('/api/admin/summary'));
  const q = filter === 'queue' ? 'filter=queue' : filter ? `status=${filter}` : '';
  const orders = useLoad(() => api<AdminOrder[]>(`/api/admin/orders?${q}`), [q]);

  useEffect(() => {
    const h = setInterval(() => { summary.reload(); orders.reload(); }, 15000);
    return () => clearInterval(h);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  async function quick(o: AdminOrder) {
    try {
      if (o.status === 'AWAITING_CONFIRMATION') await api(`/api/admin/orders/${o.id}/confirm`, { body: {} });
      else await api(`/api/admin/orders/${o.id}/deliver`, { body: {} });
      toast(o.status === 'AWAITING_CONFIRMATION' ? `Оплата №${o.id} подтверждена` : `Заказ №${o.id} выдан`);
      orders.reload();
      summary.reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  const s = summary.data;
  const max = s ? Math.max(1, ...s.hourly) : 1;

  return (
    <div className="page">
      <div className="glow" />
      <div className="between">
        <h1 className="disp" style={{ fontSize: 34 }}>{queueOnly ? 'Сегодня' : 'Заказы'}</h1>
        <span className="pill a mono" style={{ letterSpacing: '.08em' }}>ADMIN</span>
      </div>

      {queueOnly && s && (
        <>
          <div className="card pad">
            <div className="between"><span className="cap">Выручка</span><span className="muted small">прибыль {rub(s.profit)}</span></div>
            <div className="disp" style={{ fontSize: 40, marginTop: 6 }}>{rub(s.revenue)}</div>
            <svg viewBox="0 0 340 70" width="100%" height="70" style={{ marginTop: 12, display: 'block' }} role="img" aria-label="Выручка по часам">
              {s.hourly.map((v, i) => {
                const h = Math.max(3, (v / max) * 66);
                return <rect key={i} x={i * 14.2} y={70 - h} width={9} height={h} rx={3} fill={i === new Date().getHours() ? '#FF2E3E' : 'rgba(255,46,62,.25)'} />;
              })}
            </svg>
            <div className="between mono muted" style={{ fontSize: 10.5, marginTop: 6 }}><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div className="card pad"><div className="cap" style={{ fontSize: 10 }}>Заказы</div><div className="disp" style={{ fontSize: 26, marginTop: 6 }}>{s.orders}</div></div>
            <div className="card pad"><div className="cap" style={{ fontSize: 10 }}>Прибыль</div><div className="disp" style={{ fontSize: 22, marginTop: 6 }}>{rub(s.profit)}</div></div>
            <div className="card pad" style={{ background: s.queue ? 'var(--a)' : undefined, borderColor: s.queue ? 'var(--a)' : undefined }}>
              <div className="cap" style={{ fontSize: 10, color: s.queue ? 'rgba(255,255,255,.75)' : undefined }}>В очереди</div>
              <div className="disp" style={{ fontSize: 26, marginTop: 6 }}>{s.queue}</div>
            </div>
          </div>
          {s.lowStock.map((l) => (
            <a key={l.variantId} href="#/admin/products" className="row" style={{ background: 'rgba(255,181,71,.08)', border: '1px solid rgba(255,181,71,.25)', borderRadius: 16, padding: '12px 14px' }}>
              <b style={{ color: 'var(--warn)' }}>!</b><span className="sp small"><b>{l.title}:</b> осталось кодов {l.left}</span><span style={{ color: 'var(--warn)', fontWeight: 600, fontSize: 13.5 }}>Загрузить</span>
            </a>
          ))}
        </>
      )}

      {!queueOnly && (
        <div className="row" style={{ gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {FILTERS.map(([k, label]) => (
            <button key={k} className={`pill ${filter === k ? 'solid' : 'm'}`} style={{ height: 32, padding: '0 14px', fontSize: 13.5 }} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      )}

      <div className="between"><span className="cap">{filter === 'queue' ? 'Очередь выдачи' : 'Список'}</span>{s && <span className="muted small">SLA {s.slaMin} мин</span>}</div>
      {orders.data && !orders.data.length && <div className="empty">{filter === 'queue' ? 'Очередь пуста' : 'Заказов нет'}</div>}
      {orders.data && orders.data.length > 0 && (
        <div className="card list">
          {orders.data.map((o) => (
            <div key={o.id} className="row item">
              <a href={`#/admin/orders/${o.id}`} className="row sp">
                <Key icon={o.variant.product.icon} glass={o.variant.product.glass} size={42} />
                <div className="sp">
                  <div style={{ fontWeight: 600 }} className="ellipsis">{o.variant.product.title} · {o.variant.title}</div>
                  <div className="muted ellipsis" style={{ fontSize: 12.5 }}>
                    {o.recipient ?? (o.user.username ? '@' + o.user.username : o.user.firstName)} · {rub(o.amount)} · {o.method}
                  </div>
                </div>
              </a>
              {o.status === 'PAID' && o.paidAt && s ? <Timer from={o.paidAt} sla={s.slaMin} /> : <span className={`pill ${statusLabel[o.status].tone}`}>{statusLabel[o.status].text}</span>}
              {(o.status === 'PAID' || o.status === 'AWAITING_CONFIRMATION') && (
                <button className="btn icon sm" onClick={() => quick(o)} aria-label={o.status === 'PAID' ? 'Выдано' : 'Подтвердить оплату'}><Icon name="check" size={18} /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
