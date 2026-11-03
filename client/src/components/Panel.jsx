import React from 'react';

export default function Panel({ open, onClose, children }) {
  return (
    <>
      <div className={`panel-overlay${open ? ' open' : ''}`} onClick={onClose} />
      <div className={`panel${open ? ' open' : ''}`}>
        <button className="panel-close" onClick={onClose}>✕</button>
        <div>{children}</div>
      </div>
    </>
  );
}
