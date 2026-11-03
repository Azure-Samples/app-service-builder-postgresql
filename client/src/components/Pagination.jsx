import React from 'react';

const fmtNum = (n) => Number(n).toLocaleString('en-US');

export default function Pagination({ page, pages, total, onNavigate }) {
  if (pages <= 1) return null;
  const start = Math.max(1, page - 2);
  const end = Math.min(pages, start + 4);
  const buttons = [];
  for (let i = start; i <= end; i++) {
    buttons.push(i);
  }
  return (
    <div className="pagination">
      <button disabled={page <= 1} onClick={() => onNavigate(page - 1)}>‹</button>
      {buttons.map((i) => (
        <button key={i} className={i === page ? 'active' : ''} onClick={() => onNavigate(i)}>{i}</button>
      ))}
      <button disabled={page >= pages} onClick={() => onNavigate(page + 1)}>›</button>
      <span className="page-info">Page {page} of {pages} ({fmtNum(total)} total)</span>
    </div>
  );
}
