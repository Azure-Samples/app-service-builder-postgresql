import React, { useState, useCallback, useEffect } from 'react';
import { fetchOrders, fetchProducts, createOrder, advanceOrder, fetchConfig } from '../api';
import StatusBadge from '../components/StatusBadge';
import Pagination from '../components/Pagination';
import { useToast } from '../components/Toast';

const fmt = (cents) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (n) => Number(n).toLocaleString('en-US');
const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function Orders() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const toast = useToast();
  const [writesEnabled, setWritesEnabled] = useState(false);
  const [mutating, setMutating] = useState(false);
  useEffect(() => {
    fetchConfig().then((c) => setWritesEnabled(c.demoWritesEnabled)).catch((e) => setError(e.message));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { page, limit: 20 };
      if (status) params.status = status;
      const result = await fetchOrders(params);
      setData(result);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [page, status]);

  useEffect(() => { load(); }, [load]);

  const placeTestOrder = async () => {
    setMutating(true);
    try {
      const products = (await fetchProducts({ limit: 3 })).products;
      if (!products.length) { toast('No products available', 'error'); return; }
      const items = products.slice(0, 2).map((p) => ({ product_id: p.id, quantity: 1 }));
      const result = await createOrder({ customer_id: 1, items });
      if (result.error) { toast(result.error, 'error'); return; }
      toast(`Order #${result.order.id} created — ${fmt(result.order.total_cents)}`);
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setMutating(false); }
  };
  const nextStatus = { pending: 'confirmed', confirmed: 'processing', processing: 'shipped', shipped: 'delivered' };
  const advance = async (order) => {
    setMutating(true);
    try {
      await advanceOrder(order.id, nextStatus[order.status]);
      toast(`Order #${order.id} updated`);
      await load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setMutating(false); }
  };

  if (loading && !data) return <div className="loading-screen"><div className="spinner" /><div>Loading...</div></div>;
  if (error) return (
    <div className="loading-screen">
      <div style={{ color: 'var(--red)' }}>Error loading data</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{error}</div>
      <button className="btn btn-ghost" onClick={load} style={{ marginTop: 12 }}>Retry</button>
    </div>
  );

  return (
    <>
      <div className="filter-bar">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="processing">Processing</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
        </select>
        <button className="btn btn-primary" disabled={!writesEnabled || mutating} onClick={placeTestOrder}>+ Place Test Order</button>
        {!writesEnabled && <span style={{ fontSize: 12 }}>Read-only demo</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{fmtNum(data.total)} orders</span>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Customer</th><th>Email</th><th>Status</th><th>Items</th><th>Total</th><th>Date</th><th>Demo action</th></tr></thead>
            <tbody>
              {data.orders.map((o) => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 600 }}>#{o.id}</td>
                  <td>{o.first_name} {o.last_name}</td>
                  <td>{o.email}</td>
                  <td><StatusBadge status={o.status} /></td>
                  <td>{o.item_count} items</td>
                  <td style={{ fontWeight: 600 }}>{fmt(o.total_cents)}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{fmtDate(o.created_at)}</td>
                  <td>{writesEnabled && nextStatus[o.status] && <button className="btn btn-ghost btn-sm" disabled={mutating} onClick={() => advance(o)}>Mark {nextStatus[o.status]}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination page={data.page} pages={data.pages} total={data.total} onNavigate={(p) => setPage(p)} />
    </>
  );
}
