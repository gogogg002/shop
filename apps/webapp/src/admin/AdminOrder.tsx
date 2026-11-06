import { useEffect, useState } from 'react';
import { api, apiBlobUrl, copy, itemTitle, methodLabel, prettyPhone, rub, statusLabel, type AdminOrder as AO } from '../api';
import { Key, useLoad, useToast } from '../ui/kit';
import { Chat } from '../ui/Chat';

export function AdminOrder({ id }: { id: number }) {
  const { data: o, error, reload, setData } = useLoad(() => api<AO>(`/api/admin/orders/${id}`), [id]);
  const toast = useToast();
  const [proof, setProof] = useState<string | null>(null);
  const [deliverText, setDeliverText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (o?.proofFileId) apiBlobUrl(`/api/admin/orders/${id}/proof`).then(setProof).catch(() => setProof(null));
  }, [o?.proofFileId, id]);

  useEffect(() => {
    const h = setInterval(reload, 10000);
    return () => clearInterval(h);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="page"><div className="empty">{error}</div></div>;
  if (!o) return <div className="page"><div className="skeleton" style={{ height: 300 }} /></div>;

  async function act(path: string, body: object, ok: string) {
    setBusy(true);
    try {
      await api(`/api/admin/orders/${id}/${path}`, { body });
      toast(ok);
      reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  const st = statusLabel[o.status];
  const buyer = o.user.username ? `@${o.user.username}` : o.user.firstName ?? o.user.tgId;

  return (
    <div className="page">
      <div className="glow" />
      <div className="between"><h1 className="disp h1">№{o.id}</h1><span className={`pill ${st.tone}`}>{st.text}</span></div>

      <div className="card pad col">
        <div className="row">
          <Key icon={o.variant.product.icon} glass={o.variant.product.glass} size={50} />
          <div className="sp"><div style={{ fontWeight: 600, fontSize: 16 }}>{itemTitle(o.variant.product.title, o.variant.product.access, o.variant.title)}</div><div className="muted small">{methodLabel[o.method].title}{o.payAmount ? ` · ${o.payAmount}` : ''}</div></div>
          <b>{rub(o.amount)}</b>
        </div>
        <div className="sep" />
        {o.recipient && (
          <button className="between" onClick={async () => toast((await copy(o.recipient!)) ? 'Скопировано' : 'Не скопировалось')}>
            <span className="muted">Получатель</span><b className="mono">{prettyPhone(o.recipient)}</b>
          </button>
        )}
        <div className="between"><span className="muted">Покупатель</span><span>{buyer}</span></div>
        <div className="between"><span className="muted">Маржа</span><span style={{ color: o.amount - o.cost > 0 ? 'var(--ok)' : 'var(--bad)' }}>{rub(o.amount - o.cost)}</span></div>
        <div className="between"><span className="muted">Создан</span><span>{new Date(o.createdAt).toLocaleString('ru-RU')}</span></div>
        {o.deliveredText && <div className="between"><span className="muted">Выдано</span><span className="mono ellipsis">{o.deliveredText}</span></div>}
      </div>

      {proof && <img src={proof} alt="Чек оплаты" style={{ width: '100%', borderRadius: 18, border: '1px solid var(--line)' }} />}

      {o.status === 'AWAITING_CONFIRMATION' || (o.status === 'PENDING_PAYMENT' && (o.method === 'UAH' || o.method === 'SBP')) ? (
        <div className="card pad col">
          <div className="cap">Ручная оплата</div>
          <button className="btn block" disabled={busy} onClick={() => act('confirm', {}, 'Оплата подтверждена')}>Деньги пришли, подтвердить</button>
          <label className="field"><span>Причина отказа (увидит клиент)</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Перевод не найден" /></label>
          <button className="btn ghost block" disabled={busy || !reason.trim()} onClick={() => act('reject', { reason }, 'Отклонено')}>Отклонить</button>
        </div>
      ) : null}

      {o.status === 'PAID' && (
        <div className="card pad col">
          <div className="cap">Выдача</div>
          <label className="field"><span>Что передать клиенту (необязательно)</span><textarea rows={2} value={deliverText} onChange={(e) => setDeliverText(e.target.value)} placeholder="Подарок отправлен на @username" /></label>
          <button className="btn block" disabled={busy} onClick={() => act('deliver', { text: deliverText || undefined }, 'Заказ выдан')}>Выдано</button>
        </div>
      )}

      <Chat
        title="Чат с клиентом"
        asAdmin
        messages={o.messages ?? []}
        onSend={async (text) => {
          const m = await api<NonNullable<AO['messages']>[number]>(`/api/admin/orders/${id}/messages`, { body: { text } });
          // К текущему заказу, а не к копии с момента отправки: та затёрла бы статус, пришедший за это время
          setData((d) => d && (d.messages?.some((x) => x.id === m.id) ? d : { ...d, messages: [...(d.messages ?? []), m] }));
        }}
      />
    </div>
  );
}
