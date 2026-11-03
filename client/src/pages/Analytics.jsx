import React, { useState, useEffect } from 'react';
import { fetchRevenue, fetchTopProducts, fetchDashboard } from '../api';

const fmt = (cents) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (n) => Number(n).toLocaleString('en-US');
const fmtDateShort = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const statusColors = {
  delivered: 'var(--green)', shipped: 'var(--blue)', processing: 'var(--accent)',
  confirmed: 'var(--amber)', pending: 'var(--amber)', cancelled: 'var(--red)',
};

export default function Analytics() {
  const [revenue, setRevenue] = useState(null);
  const [topProducts, setTopProducts] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchRevenue('day', 14),
      fetchTopProducts(10),
      fetchDashboard(),
    ])
      .then(([rev, top, dash]) => {
        setRevenue(rev);
        setTopProducts(top);
        setDashboard(dash);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="loading-screen"><div className="spinner" /><div>Loading...</div></div>;
  if (error) return (
    <div className="loading-screen">
      <div style={{ color: 'var(--red)' }}>Error loading data</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{error}</div>
    </div>
  );

  const maxRev = Math.max(...revenue.revenue.map((r) => parseInt(r.revenue)), 1);
  const totalOrders = dashboard.orders_by_status.reduce((s, x) => s + parseInt(x.count), 0);

  return (
    <>
      <div className="two-col" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="card-header"><h3>Revenue (Last 14 Days)</h3></div>
          <div className="card-body">
            <div className="chart-bars">
              {revenue.revenue.map((r, i) => {
                const h = Math.max(3, (parseInt(r.revenue) / maxRev * 100));
                return (
                  <div key={i} className="chart-bar">
                    <div className="chart-bar-fill" style={{ height: `${h}%`, background: 'var(--accent)' }} title={`${fmt(r.revenue)} (${r.order_count} orders)`} />
                    <div className="chart-bar-label">{fmtDateShort(r.period)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Orders by Status</h3></div>
          <div className="card-body">
            <div className="status-bars">
              {dashboard.orders_by_status.map((s) => {
                const pct = (parseInt(s.count) / totalOrders * 100).toFixed(1);
                return (
                  <div key={s.status} className="status-row">
                    <div className="status-label">{s.status}</div>
                    <div className="status-bar-track">
                      <div className="status-bar-fill" style={{ width: `${pct}%`, background: statusColors[s.status] || 'var(--accent)' }}>{s.count}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-header"><h3>Top 10 Products by Revenue</h3></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Product</th><th>Vendor</th><th>Sold</th><th>Revenue</th></tr></thead>
            <tbody>
              {topProducts.products.map((p, i) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{i + 1}</td>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>{p.vendor_name}</td>
                  <td>{fmtNum(p.total_sold)} units</td>
                  <td style={{ fontWeight: 600 }}>{fmt(p.total_revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
