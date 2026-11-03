import React from 'react';
import useApi from '../hooks/useApi';
import { fetchDashboard } from '../api';
import MetricCard from '../components/MetricCard';
import StatusBadge from '../components/StatusBadge';
import StarRating from '../components/StarRating';

const fmt = (cents) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (n) => Number(n).toLocaleString('en-US');
const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function Dashboard() {
  const { data, loading, error, refresh } = useApi(fetchDashboard);

  if (loading) return <div className="loading-screen"><div className="spinner" /><div>Loading...</div></div>;
  if (error) return (
    <div className="loading-screen">
      <div style={{ color: 'var(--red)' }}>Error loading data</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{error}</div>
      <button className="btn btn-ghost" onClick={refresh} style={{ marginTop: 12 }}>Retry</button>
    </div>
  );

  const statusColorMap = {
    delivered: '--green', shipped: '--blue', pending: '--amber',
    confirmed: '--amber', processing: '--accent', cancelled: '--red',
  };

  const miniBars = data.orders_by_status.map((s) => {
    const pct = Math.max(5, (s.count / data.order_count * 100));
    const color = `var(${statusColorMap[s.status] || '--accent'})`;
    return <span key={s.status} style={{ height: `${pct}%`, background: color }} title={`${s.status}: ${s.count}`} />;
  });

  return (
    <>
      <div className="metric-grid">
        <MetricCard label="Total Revenue" value={fmt(data.revenue_cents)} sub={`${fmtNum(data.order_count)} orders`}>
          <div className="mini-bar">{miniBars}</div>
        </MetricCard>
        <MetricCard label="Orders" value={fmtNum(data.order_count)} sub={data.orders_by_status.map(s => `${s.count} ${s.status}`).join(', ')} />
        <MetricCard label="Customers" value={fmtNum(data.customer_count)} sub="Registered accounts" />
        <MetricCard label="Active Products" value={fmtNum(data.product_count)} sub={`${data.top_vendors.length} vendors`} />
      </div>
      <div className="two-col">
        <div className="card">
          <div className="card-header"><h3>Recent Orders</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>Customer</th><th>Status</th><th>Items</th><th>Total</th><th>Date</th></tr></thead>
              <tbody>
                {data.recent_orders.map((o) => (
                  <tr key={o.id}>
                    <td style={{ fontWeight: 600 }}>#{o.id}</td>
                    <td>{o.first_name} {o.last_name}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td>{o.item_count} items</td>
                    <td style={{ fontWeight: 600 }}>{fmt(o.total_cents)}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{fmtDate(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Top Vendors</h3></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Vendor</th><th>Products</th><th>Rating</th><th>Revenue</th></tr></thead>
              <tbody>
                {data.top_vendors.map((v, i) => (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{v.name}</td>
                    <td>{v.product_count} products</td>
                    <td><StarRating rating={v.rating} /> {Number(v.rating).toFixed(1)}</td>
                    <td style={{ fontWeight: 600 }}>{fmt(v.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
