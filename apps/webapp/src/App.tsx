import { createContext, useContext, useEffect, useState } from 'react';
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

function useHash() {
  const [hash, setHash] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => {
      setHash(location.hash.slice(1) || '/');
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const [path, query = ''] = hash.split('?');
  return { path, query: new URLSearchParams(query) };
}

export const go = (to: string) => {
  location.hash = to;
};

const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx);

function Nav({ admin, path }: { admin: boolean; path: string }) {
  const items = admin
    ? [['/admin', 'chart', 'Сводка'], ['/admin/orders', 'list', 'Заказы'], ['/admin/products', 'box', 'Товары'], ['/admin/settings', 'gear', 'Настройки']]
    : [['/', 'grid', 'Витрина'], ['/orders', 'list', 'Заказы']];
  const active = (to: string) => (to === '/' || to === '/admin' ? path === to : path.startsWith(to));
  return (
    <nav className="nav" aria-label="Разделы">
      {items.map(([to, icon, label]) => (
        <a key={to} href={`#${to}`} className={active(to) ? 'on' : ''} aria-label={label}>
          <Icon name={icon} />
          {active(to) && label}
        </a>
      ))}
    </nav>
  );
}

export function App() {
  const { path, query } = useHash();
  const me = useLoad(() => api<Me>('/api/me'));

  useEffect(() => {
    tg?.ready();
    tg?.expand();
    tg?.setHeaderColor('#000000');
    tg?.setBackgroundColor('#000000');
  }, []);

  // Системная кнопка «Назад» Telegram на вложенных экранах
  useEffect(() => {
    if (!tg) return;
    const nested = path !== '/' && path !== '/orders' && path !== '/admin';
    const back = () => history.back();
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
    if (seg[0] === 'product') { screen = <Product id={Number(seg[1])} />; showNav = false; }
    else if (seg[0] === 'checkout') { screen = <Checkout variantId={Number(query.get('v'))} recipient={query.get('r') ?? ''} />; showNav = false; }
    else if (seg[0] === 'orders' && seg[1]) { screen = <Order id={Number(seg[1])} />; showNav = false; }
    else if (seg[0] === 'orders') screen = <Orders />;
    else screen = <Catalog category={query.get('c')} />;
  } else {
    if (seg[1] === 'orders' && seg[2]) { screen = <AdminOrder id={Number(seg[2])} />; showNav = false; }
    else if (seg[1] === 'orders') screen = <Dashboard queueOnly={false} />;
    else if (seg[1] === 'products' && seg[2]) { screen = <ProductEdit id={seg[2] === 'new' ? null : Number(seg[2])} />; showNav = false; }
    else if (seg[1] === 'products') screen = <Products />;
    else if (seg[1] === 'settings') screen = <Settings />;
    else screen = <Dashboard queueOnly />;
  }

  return (
    <MeCtx.Provider value={me.data}>
      {screen}
      {showNav && <Nav admin={isAdminPath} path={path} />}
    </MeCtx.Provider>
  );
}
