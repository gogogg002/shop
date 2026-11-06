import { useState } from 'react';
import { Icon, useToast } from './kit';

export interface ChatMsg { id: number; text: string; fromAdmin: boolean; createdAt: string }

/**
 * Ответ на отправку потерялся, а заказ перечитан: есть ли там это сообщение (новое, с нашей стороны, тот же
 * текст). Если есть, оно дошло, и отправлять его ещё раз не нужно
 */
export const arrived = (messages: ChatMsg[] | undefined, known: Set<number>, text: string, fromAdmin: boolean) =>
  (messages ?? []).some((m) => !known.has(m.id) && m.fromAdmin === fromAdmin && m.text === text);

/** Чат по заказу. asAdmin — сообщения админа справа. */
export function Chat({ messages, onSend, asAdmin, title }: {
  messages: ChatMsg[];
  onSend: (text: string) => Promise<void>;
  asAdmin: boolean;
  title: string;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function send() {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      await onSend(t);
      setText('');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card pad col" aria-label={title}>
      <div className="cap">{title}</div>
      {!messages.length && <div className="muted small">Сообщений пока нет. Вопрос по заказу можно задать здесь.</div>}
      <div className="col" style={{ gap: 6 }}>
        {messages.map((m) => (
          <div key={m.id} className={`chatline ${m.fromAdmin === asAdmin ? 'me' : 'them'}`}>{m.text}</div>
        ))}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <label className="field sp" style={{ padding: '8px 12px' }}>
          <span className="sr" style={{ display: 'none' }}>Сообщение</span>
          <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="Написать…" aria-label="Сообщение" />
        </label>
        <button className="btn icon" style={{ height: 46, width: 46, borderRadius: 14 }} onClick={send} disabled={busy || !text.trim()} aria-label="Отправить">
          <Icon name="send" size={20} />
        </button>
      </div>
    </section>
  );
}
