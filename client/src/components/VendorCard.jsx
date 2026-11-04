import React from 'react';
import StarRating from './StarRating';

const vgradClass = (id) => 'vgrad-' + ((id % 10) + 1);
const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function VendorCard({ vendor, onClick }) {
  const v = vendor;
  return (
    <div className="vendor-card" onClick={onClick}>
      <div className={`vendor-avatar ${vgradClass(v.id)}`}>{v.name.charAt(0)}</div>
      <div className="vendor-name">{v.name}</div>
      <div className="vendor-desc">{v.description || ''}</div>
      <div className="vendor-stats">
        <div className="vendor-stat"><strong>{v.product_count}</strong> products</div>
        <div className="vendor-stat"><strong>{Number(v.rating).toFixed(1)}</strong> ★ rating</div>
        <div className="vendor-stat">Joined {fmtDate(v.created_at)}</div>
      </div>
    </div>
  );
}
