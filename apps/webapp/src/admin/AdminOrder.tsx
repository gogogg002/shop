import { useEffect, useState } from 'react';
import { api, apiBlobUrl, copy, isNetwork, itemTitle, variantText, methodLabel, orderStatus, prettyPhone, rub, type AdminOrder as AO } from '../api';
import { Key, Stale, useLoad, useToast } from '../ui/kit';
import { arrived, Chat } from '../ui/Chat';

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

  // Обновление не удалось, но заказ уже на экране: показываем его с пометкой, недописанный ответ в чате остаётся
  if (!o) return <div className="page">{error ? <div className="empty">{error}</div> : <div className="skeleton" style={{ height: 300 }} />}</div>;

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

  const st = orderStatus(o);
  const buyer = o.user.username ? `@${o.user.username}` : o.user.firstName ?? o.user.tgId;

  return (
    <div className="page">
      <div className="glow" />
      <div className="between"><h1 className="disp h1">№{o.id}</h1><span className={`pill ${st.tone}`}>{st.text}</span></div>
      {error && <Stale error={error} />}

      <div className="card pad col">
        <div className="row">
          <Key icon={o.variant.product.icon} glass={o.variant.product.glass} size={50} />
          <div className="sp"><div style={{ fontWeight: 600, fontSize: 16 }}>{itemTitle(o.variant.product.title, o.variant.product.access, variantText(o.variant, o.quantity))}</div><div className="muted small">{methodLabel[o.method].title}{o.payAmount ? ` · ${o.payAmount}` : ''}</div></div>
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
          {o.deliveredText && (
            <div className="muted small" style={{ lineHeight: 1.45 }}>
              Уже выдано: <b className="mono" style={{ color: 'var(--t)', wordBreak: 'break-all' }}>{o.deliveredText}</b>
            </div>
          )}
          <label className="field"><span>Что выдать клиенту: карта, код, ссылка</span><textarea rows={2} value={deliverText} onChange={(e) => setDeliverText(e.target.value)} placeholder="Карта 4441 1111 2222 3333, до 12/28" /></label>
          <button className="btn ghost block" disabled={busy || !deliverText.trim()} onClick={() => act('issue', { text: deliverText }, 'Выдано, заказ в работе')}>
            {o.deliveredText ? 'Выдать заново, не завершая' : 'Выдать, не завершая'}
          </button>
          <button className="btn block" disabled={busy} onClick={() => act('deliver', { text: deliverText.trim() || undefined }, 'Заказ завершён')}>Завершить заказ</button>
          <div className="muted small" style={{ lineHeight: 1.45 }}>После завершения клиенту придёт просьба об отзыве.</div>
        </div>
      )}

      <Chat
        title="Чат с клиентом"
        asAdmin
        messages={o.messages ?? []}
        onSend={async (text) => {
          const known = new Set((o.messages ?? []).map((m) => m.id));
          try {
            const m = await api<NonNullable<AO['messages']>[number]>(`/api/admin/orders/${id}/messages`, { body: { text } });
            // К текущему заказу, а не к копии с момента отправки: та затёрла бы статус, пришедший за это время
            setData((d) => d && (d.messages?.some((x) => x.id === m.id) ? d : { ...d, messages: [...(d.messages ?? []), m] }));
          } catch (e) {
            if (!isNetwork(e)) throw e;
            // Ответ мог потеряться, когда сообщение уже сохранено и ушло клиенту: повтор пришлёт его дважды.
            // Прежде чем предлагать повтор, смотрим, дошло ли оно
            const fresh = await api<AO>(`/api/admin/orders/${id}`).catch(() => null);
            if (fresh) setData(fresh);
            if (!fresh) throw new Error('Связь оборвалась, сообщение могло дойти. Подождите минуту');
            if (!arrived(fresh.messages, known, text, true)) throw new Error('Связь оборвалась, сообщение не дошло. Отправьте ещё раз');
          } finally {
            // Обновление, ушедшее до сообщения, могло вернуться позже и стереть его: новый запрос отменяет старый
            reload();
          }
        }}
      />
    </div>
  );
}
