import React from 'react';
import StarRating from './StarRating';

const gradClass = (id) => 'grad-' + ((id % 10) + 1);
const stockClass = (qty) => qty > 20 ? 'stock-ok' : qty > 0 ? 'stock-low' : 'stock-out';
const stockLabel = (qty) => qty > 20 ? 'In Stock' : qty > 0 ? `${qty} left` : 'Out of Stock';
const fmt = (cents) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ProductCard({ product, categoryIcon, onClick }) {
  const p = product;
  return (
    <div className="product-card" onClick={onClick}>
      <div className={`product-img ${gradClass(p.id)}`}>{categoryIcon || '📦'}</div>
      <div className="product-info">
        <div className="product-name">{p.name}</div>
        <div className="product-vendor">{p.vendor_name}</div>
        <div>
          <span className="product-price">{fmt(p.price_cents)}</span>
          {p.compare_price_cents && (
            <span className="product-compare">{fmt(p.compare_price_cents)}</span>
          )}
        </div>
        <div className="product-meta">
          <StarRating rating={p.rating_avg} />
          <span className={`stock-badge ${stockClass(p.stock_qty)}`}>{stockLabel(p.stock_qty)}</span>
        </div>
      </div>
    </div>
  );
}
