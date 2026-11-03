import React, { useState } from 'react';
import useApi from '../hooks/useApi';
import { fetchVendors, fetchVendor } from '../api';
import VendorCard from '../components/VendorCard';
import StarRating from '../components/StarRating';
import Panel from '../components/Panel';

const fmt = (cents) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gradClass = (id) => 'grad-' + ((id % 10) + 1);
const vgradClass = (id) => 'vgrad-' + ((id % 10) + 1);

export default function Vendors({ onShowProduct }) {
  const { data, loading, error, refresh } = useApi(fetchVendors);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelData, setPanelData] = useState(null);

  const showVendor = async (id) => {
    try {
      const result = await fetchVendor(id);
      setPanelData(result);
      setPanelOpen(true);
    } catch {}
  };

  if (loading) return <div className="loading-screen"><div className="spinner" /><div>Loading...</div></div>;
  if (error) return (
    <div className="loading-screen">
      <div style={{ color: 'var(--red)' }}>Error loading data</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{error}</div>
      <button className="btn btn-ghost" onClick={refresh} style={{ marginTop: 12 }}>Retry</button>
    </div>
  );

  return (
    <>
      <div className="vendor-grid">
        {data.vendors.map((v) => (
          <VendorCard key={v.id} vendor={v} onClick={() => showVendor(v.id)} />
        ))}
      </div>
      <Panel open={panelOpen} onClose={() => setPanelOpen(false)}>
        {panelData && <VendorDetail data={panelData} />}
      </Panel>
    </>
  );
}

function VendorDetail({ data: { vendor: v, products } }) {
  return (
    <>
      <div className={`vendor-avatar ${vgradClass(v.id)}`} style={{ width: 64, height: 64, fontSize: 28, borderRadius: 16, marginBottom: 16 }}>{v.name.charAt(0)}</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{v.name}</h2>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>{v.email}</div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.7 }}>{v.description || ''}</div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, fontSize: 13 }}>
        <span><strong>Rating:</strong> <StarRating rating={v.rating} /> {Number(v.rating).toFixed(1)}</span>
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Products ({products.length})</h3>
      {products.map((p) => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <div className={gradClass(p.id)} style={{ width: 40, height: 40, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{p.category_name ? '' : '📦'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.category_name}</div>
          </div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{fmt(p.price_cents)}</div>
        </div>
      ))}
    </>
  );
}
