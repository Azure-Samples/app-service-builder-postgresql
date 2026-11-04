const BASE = '';

export async function api(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error || `API error: ${res.status}`);
  }
  return res.json();
}

export async function apiPost(path, body, method = 'POST') {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || `API error: ${res.status}`);
  return result;
}

// Dashboard
export const fetchDashboard = () => api('/api/dashboard');
export const fetchConfig = () => api('/api/config');

// Products
export const fetchProducts = (params) => api('/api/products?' + new URLSearchParams(params));
export const fetchProduct = (id) => api(`/api/products/${id}`);
export const searchProducts = (q, limit = 20) => api(`/api/products/search?q=${encodeURIComponent(q)}&limit=${limit}`);

// Categories
export const fetchCategories = () => api('/api/categories');

// Orders
export const fetchOrders = (params) => api('/api/orders?' + new URLSearchParams(params));
export const fetchOrder = (id) => api(`/api/orders/${id}`);
export const createOrder = (data) => apiPost('/api/orders', data);
export const advanceOrder = (id, status) => apiPost(`/api/orders/${id}`, { status }, 'PATCH');

// Vendors
export const fetchVendors = () => api('/api/vendors');
export const fetchVendor = (id) => api(`/api/vendors/${id}`);

// Reviews
export const submitReview = (data) => apiPost('/api/reviews', data);
export const deleteReview = (id) => apiPost(`/api/reviews/${id}`, {}, 'DELETE');

// Analytics
export const fetchRevenue = (period = 'day', limit = 14) => api(`/api/analytics/revenue?period=${period}&limit=${limit}`);
export const fetchTopProducts = (limit = 10) => api(`/api/analytics/top-products?limit=${limit}`);
