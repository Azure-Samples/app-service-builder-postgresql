import React from 'react';

export default function MetricCard({ label, value, sub, children }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
      {children}
    </div>
  );
}
