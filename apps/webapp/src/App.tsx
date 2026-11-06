import { Component, createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tg, type Me } from './api';
import { Icon, useLoad } from './ui/kit';
import { Catalog } from './screens/Catalog';
import { Product } from './screens/Product';
import { Checkout } from './screens/Checkout';
import { Orders } from './screens/Orders';
import { Order } from './screens/Order';
import { Dashboard } from './admin/Dashboard';
import { AdminOrder } from './admin/AdminOrder';
import { Products } from './admin/Products';
import { ProductEdit } from './admin/ProductEdit';
import { Settings } from './admin/Settings';
import { Review } from './screens/Review';
import { Reviews } from './screens/Reviews';
import { AdminReviews } from './admin/AdminReviews';

/**
 * Telegram дописывает параметры запуска в hash: «#tgWebAppData=…» или «#/admin?tgWebAppData=…».
 * Путь — то, что до «?», и только если начинается с «/».
 */
export function parseHash(raw: string) {
  const hash = raw.replace(/^#/, '');
  const [p, query = ''] = hash.split('?');
  return { path: p.startsWith('/') ? p : '/', query: new URLSearchParams(query) };
}

function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => {
      setHash(location.hash);
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return parseHash(hash);
}

export const go = (to: string) => {
  location.hash = to;
};

/**
 * Первая запись истории мини-аппа помечена: с неё «Назад» некуда, и мы уходим на экран-родитель.
 * history.length для этого не годится: он считает и записи «вперёд», а не текущую позицию.
 */
const ROOT = 'krynelRoot';
const isRoot = () => Boolean((history.state as Record<string, unknown> | null)?.[ROOT]);
const markRoot = () => history.replaceState({ ...((history.state as object | null) ?? {}), [ROOT]: true }, '');
// Запись, с которой открыли мини-апп (или перезагрузили страницу), считаем первой
if (!isRoot()) markRoot();

/** Переход без новой записи в истории (вкладки товара): «Назад» ведёт туда, откуда пришли */
export const swap = (to: string) => {
  const root = isRoot();
  location.replace(`#${to}`);
  if (root) markRoot();
};

/** «Назад» внутри мини-аппа: на прошлый экран, а если открыли сразу здесь (кнопка из бота), на экран-родитель */
export const back = () => {
  if (isRoot()) swap(parentOf(parseHash(location.hash).path));
  else history.back();
};

function parentOf(path: string) {
  const seg = path.split('/').filter(Boolean);
  if (seg[0] === 'orders' && seg[2]) return `/orders/${seg[1]}`;
  if (seg[0] === 'orders') return '/orders';
  if (seg[0] === 'admin' && seg[2]) return `/admin/${seg[1]}`;
  if (seg[0] === 'admin') return '/admin';
  return '/';
}

/**
 * Ошибка при отрисовке экрана не гасит весь мини-апп: React без такой обёртки снимает всё дерево, и экран
 * остаётся чёрным до перезапуска. Переход на другой экран сбрасывает ошибку
 */
class Crash extends Component<{ path: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prev: { path: string }) {
    if (prev.path !== this.props.path && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page">
        <div className="empty">Экран не открылся из-за ошибки</div>
        <button className="btn block" onClick={() => location.reload()}>Обновить</button>
      </div>
    );
  }
}

const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx);

function Nav({ admin, isAdmin, path }: { admin: boolean; isAdmin: boolean; path: string }) {
  // Админу вход в админку виден сразу, в нижней панели витрины; обратно в витрину — кнопка на сводке
  const items = admin
    ? [['/admin', 'chart', 'Сводка'], ['/admin/orders', 'list', 'Заказы'], ['/admin/products', 'box', 'Товары'], ['/admin/reviews', 'starO', 'Отзывы'], ['/admin/settings', 'gear', 'Настройки']]
    : [['/', 'gem', 'Витрина'], ['/orders', 'list', 'Заказы'], ...(isAdmin ? [['/admin', 'shield', 'Админка']] : [])];
  const active = (to: string) => (to === '/' || to === '/admin' ? path === to : path.startsWith(to));
  return (
    <nav className="nav" aria-label="Разделы">
      {items.map(([to, icon, label]) => (
        <a key={to} href={`#${to}`} className={active(to) ? 'on' : ''} aria-current={active(to) ? 'page' : undefined}>
          <Icon name={icon} />
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}

export function App() {
  const { path, query } = useHash();
  const me = useLoad(() => api<Me>('/api/me'));
  // Без профиля мини-апп не работает: если на старте не было связи, пробуем снова, пока не получится
  useEffect(() => {
    if (!me.error) return;
    const h = setInterval(me.reload, 5000);
    return () => clearInterval(h);
  }, [me.error]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    tg?.ready();
    tg?.expand();
    tg?.setHeaderColor('#060607');
    tg?.setBackgroundColor('#060607');
  }, []);

  // Системная кнопка «Назад» Telegram на вложенных экранах
  useEffect(() => {
    if (!tg) return;
    const nested = !['/', '/orders', '/admin', '/admin/orders', '/admin/products', '/admin/reviews', '/admin/settings'].includes(path);
    if (nested) {
      tg.BackButton.show();
      tg.BackButton.onClick(back);
    } else tg.BackButton.hide();
    return () => tg?.BackButton.offClick(back);
  }, [path]);

  if (me.error) return <div className="page"><div className="empty">{me.error}</div></div>;
  if (!me.data) return <div className="page"><div className="skeleton" style={{ height: 300 }} /></div>;

  const seg = path.split('/').filter(Boolean);
  const isAdminPath = seg[0] === 'admin';
  if (isAdminPath && !me.data.isAdmin) return <div className="page"><div className="empty">Раздел только для администратора</div></div>;

  let screen: JSX.Element;
  let showNav = true;
  if (!isAdminPath) {
    if (seg[0] === 'product') { screen = <Product key={seg[1]} id={Number(seg[1])} />; showNav = false; }
    else if (seg[0] === 'checkout') { screen = <Checkout variantId={Number(query.get('v'))} recipient={query.get('r') ?? ''} />; showNav = false; }
    else if (seg[0] === 'orders' && seg[1] && seg[2] === 'review') { screen = <Review orderId={Number(seg[1])} preset={Number(query.get('r')) || 0} />; showNav = false; }
    else if (seg[0] === 'orders' && seg[1]) { screen = <Order id={Number(seg[1])} />; showNav = false; }
    else if (seg[0] === 'reviews') { screen = <Reviews productId={Number(query.get('p')) || null} />; showNav = false; }
    else if (seg[0] === 'orders') screen = <Orders />;
    else screen = <Catalog category={query.get('c')} />;
  } else {
    if (seg[1] === 'orders' && seg[2]) { screen = <AdminOrder id={Number(seg[2])} />; showNav = false; }
    else if (seg[1] === 'orders') screen = <Dashboard queueOnly={false} />;
    else if (seg[1] === 'products' && seg[2]) { screen = <ProductEdit id={seg[2] === 'new' ? null : Number(seg[2])} />; showNav = false; }
    else if (seg[1] === 'products') screen = <Products />;
    else if (seg[1] === 'settings') screen = <Settings />;
    else if (seg[1] === 'reviews') screen = <AdminReviews />;
    else screen = <Dashboard queueOnly />;
  }

  return (
    <MeCtx.Provider value={me.data}>
      <Crash path={path}>{screen}</Crash>
      {showNav && <Nav admin={isAdminPath} isAdmin={me.data.isAdmin} path={path} />}
    </MeCtx.Provider>
  );
}
