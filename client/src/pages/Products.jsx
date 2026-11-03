import React, { useState, useEffect, useCallback } from 'react';
import { fetchProducts, fetchCategories, fetchProduct, fetchConfig, submitReview, deleteReview } from '../api';
import { useToast } from '../components/Toast';
import ProductCard from '../components/ProductCard';
import Pagination from '../components/Pagination';
import Panel from '../components/Panel';
import StarRating from '../components/StarRating';

const fmt = (cents) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (n) => Number(n).toLocaleString('en-US');
const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const gradClass = (id) => 'grad-' + ((id % 10) + 1);
const stockClass = (qty) => qty > 20 ? 'stock-ok' : qty > 0 ? 'stock-low' : 'stock-out';
const stockLabel = (qty) => qty > 20 ? 'In Stock' : qty > 0 ? `${qty} left` : 'Out of Stock';

export default function Products({ initialSearch }) {
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('newest');
  const [search, setSearch] = useState(initialSearch || '');
  const [data, setData] = useState(null);
  const [categories, setCategories] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelData, setPanelData] = useState(null);
  const [writesEnabled, setWritesEnabled] = useState(false);
  const toast = useToast();
  useEffect(() => {
    fetchConfig().then((c) => setWritesEnabled(c.demoWritesEnabled)).catch((e) => toast(e.message, 'error'));
  }, []);

  // Reset search from parent
  useEffect(() => {
    if (initialSearch && initialSearch !== search) {
      setSearch(initialSearch);
      setPage(1);
    }
  }, [initialSearch]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!categories) {
        const c = await fetchCategories();
        setCategories(c.categories);
      }
      const params = { page, limit: 24, sort };
      if (search) params.search = search;
      if (category) params.category = category;
      const result = await fetchProducts(params);
      setData(result);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [page, category, sort, search]);

  useEffect(() => { load(); }, [load]);

  const showProduct = async (id) => {
    try {
      const result = await fetchProduct(id);
      setPanelData(result);
      setPanelOpen(true);
    } catch (e) { toast(e.message, 'error'); }
  };

  if (loading && !data) return <div className="loading-screen"><div className="spinner" /><div>Loading...</div></div>;
  if (error) return (
    <div className="loading-screen">
      <div style={{ color: 'var(--red)' }}>Error loading data</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{error}</div>
      <button className="btn btn-ghost" onClick={load} style={{ marginTop: 12 }}>Retry</button>
    </div>
  );

  const cats = categories || [];

  return (
    <>
      <div className="filter-bar">
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); load(); } }}
          style={{ width: 220 }}
        />
        <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
          <option value="">All Categories</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.icon || ''} {c.name}</option>)}
        </select>
        <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
          <option value="newest">Newest</option>
          <option value="price">Price</option>
          <option value="rating">Rating</option>
          <option value="name">Name</option>
        </select>
        {search && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setPage(1); }}>✕ Clear search</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{fmtNum(data.total)} products</span>
      </div>
      <div className="product-grid">
        {data.products.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            categoryIcon={(cats.find((c) => c.id === p.category_id) || {}).icon}
            onClick={() => showProduct(p.id)}
          />
        ))}
      </div>
      <Pagination page={data.page} pages={data.pages} total={data.total} onNavigate={(p) => setPage(p)} />

      <Panel open={panelOpen} onClose={() => setPanelOpen(false)}>
        {panelData && <ProductDetail key={panelData.product.id} data={panelData} categories={cats} writesEnabled={writesEnabled} reload={async () => { await showProduct(panelData.product.id); await load(); }} />}
      </Panel>
    </>
  );
}

function ProductDetail({ data: { product: p, reviews }, categories, writesEnabled, reload }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState('5');
  const [title, setTitle] = useState('');
  const addReview = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await submitReview({ product_id: p.id, customer_id: 1, rating: Number(rating), title, body: 'Created by the ShopStream DEV/TEST demo.' });
      setTitle('');
      await reload();
      toast('Demo review saved');
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  };
  const removeReview = async (id) => {
    if (!window.confirm('Delete this review from the demo database?')) return;
    setBusy(true);
    try { await deleteReview(id); await reload(); toast('Demo review deleted'); }
    catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  };
  const catIcon = (categories.find((c) => c.id === p.category_id) || {}).icon || '📦';
  return (
    <>
      <div className={`product-img ${gradClass(p.id)}`} style={{ height: 200, borderRadius: 'var(--radius)', marginBottom: 16, fontSize: 64 }}>{catIcon}</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{p.name}</h2>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>by {p.vendor_name} · {p.category_name}</div>
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>{fmt(p.price_cents)}</span>
        {p.compare_price_cents && (
          <span style={{ fontSize: 14, color: 'var(--text-muted)', textDecoration: 'line-through', marginLeft: 8 }}>{fmt(p.compare_price_cents)}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 13 }}>
        <span><strong>Rating:</strong> <StarRating rating={p.rating_avg} /> {Number(p.rating_avg).toFixed(1)} ({p.review_count})</span>
        <span><strong>Stock:</strong> <span className={`stock-badge ${stockClass(p.stock_qty)}`}>{stockLabel(p.stock_qty)}</span></span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.7 }}>{p.description || 'No description available.'}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>SKU: {p.sku || 'N/A'}</div>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Reviews ({reviews.length})</h3>
      {writesEnabled && <form onSubmit={addReview} className="filter-bar">
        <input aria-label="Demo review title" maxLength={200} placeholder="Demo review title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select aria-label="Demo review rating" value={rating} onChange={(e) => setRating(e.target.value)}>{[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r} stars</option>)}</select>
        <button className="btn btn-primary" disabled={busy}>Add demo review</button>
      </form>}
      {reviews.length ? reviews.map((r) => (
        <div key={r.id} className="review-item">
          <div className="review-header">
            <span className="review-author">{r.first_name} {r.last_name} {r.is_verified && <span style={{ color: 'var(--green)', fontSize: 11 }}>✓ Verified</span>}</span>
            <span className="review-date">{fmtDate(r.created_at)}</span>
          </div>
          <div style={{ marginBottom: 4 }}><StarRating rating={r.rating} /></div>
          {r.title && <div className="review-title">{r.title}</div>}
          <div className="review-body">{r.body}</div>
          {writesEnabled && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => removeReview(r.id)}>Delete demo review</button>}
        </div>
      )) : <div style={{ padding: '20px 0', color: 'var(--text-muted)', fontSize: 13 }}>No reviews yet</div>}
    </>
  );
}
