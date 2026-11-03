import React from 'react';

export default function StarRating({ rating }) {
  const r = Number(rating) || 0;
  const full = Math.floor(r);
  const half = r - full >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  const display = '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
  return <span className="stars" title={r.toFixed(1)}>{display}</span>;
}
