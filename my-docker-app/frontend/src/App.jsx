import { useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function Toast({ toasts }) {
  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

function ItemCard({ item, index }) {
  const time = new Date(item.created_at).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit',
  });
  return (
    <article className="item-card" style={{ animationDelay: `${index * 40}ms` }}>
      <div className="item-id">#{item.id}</div>
      <span className="item-name">{item.name}</span>
      <span className="item-time">{time}</span>
    </article>
  );
}

export default function App() {
  const [items, setItems]         = useState([]);
  const [dbStatus, setDbStatus]   = useState('checking');
  const [backendOk, setBackendOk] = useState(false);
  const [inputName, setInputName] = useState('');
  const [loading, setLoading]     = useState(false);
  const [fetching, setFetching]   = useState(true);
  const [toasts, setToasts]       = useState([]);

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API}/health`);
      const data = await res.json();
      setBackendOk(true);
      setDbStatus(data.db === 'connected' ? 'connected' : 'disconnected');
    } catch {
      setBackendOk(false);
      setDbStatus('disconnected');
    }
  }, []);

  const fetchItems = useCallback(async () => {
    setFetching(true);
    try {
      const res = await fetch(`${API}/items`);
      if (!res.ok) throw new Error('Fetch failed');
      const data = await res.json();
      setItems(data);
    } catch {
      addToast('Failed to load items from server.', 'error');
    } finally {
      setFetching(false);
    }
  }, [addToast]);

  useEffect(() => {
    checkHealth();
    fetchItems();
    const interval = setInterval(checkHealth, 10_000);
    return () => clearInterval(interval);
  }, [checkHealth, fetchItems]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const name = inputName.trim();
    if (!name) return;

    setLoading(true);
    try {
      const res = await fetch(`${API}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const newItem = await res.json();
      setItems((prev) => [newItem, ...prev]);
      setInputName('');
      addToast(`"${name}" added successfully!`, 'success');
    } catch (err) {
      addToast(`Failed to add item: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const statusLabel = dbStatus === 'checking'
    ? 'Checking...'
    : dbStatus === 'connected'
      ? 'Connected'
      : 'Disconnected';

  return (
    <div className="app">
      <header className="header">
        <div className="header-badge">
          <span className="dot" />
          Docker Full-Stack Demo
        </div>
        <h1>Item Manager</h1>
        <p>React + Node.js + MySQL, orchestrated with Docker Compose</p>
      </header>

      <section className="status-bar" aria-label="System status">
        <div className="status-card">
          <div className="status-icon purple"></div>
          <div>
            <div className="status-label">Backend</div>
            <div className="status-value">
              <span className={`badge ${backendOk ? 'connected' : 'disconnected'}`}>
                {backendOk ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>
        </div>

        <div className="status-card">
          <div className="status-icon cyan"></div>
          <div>
            <div className="status-label">Database</div>
            <div className="status-value">
              <span className={`badge ${dbStatus}`}>{statusLabel}</span>
            </div>
          </div>
        </div>

        <div className="status-card">
          <div className="status-icon purple"></div>
          <div>
            <div className="status-label">Total Items</div>
            <div className="status-value">{items.length}</div>
          </div>
        </div>
      </section>

      <div className="divider" />

      <section className="section">
        <div className="section-header">
          <h2>Add New Item</h2>
        </div>
        <div className="form-card">
          <form onSubmit={handleSubmit} id="add-item-form">
            <div className="form-row">
              <input
                id="item-name-input"
                className="form-input"
                type="text"
                placeholder="Enter item name..."
                value={inputName}
                onChange={(e) => setInputName(e.target.value)}
                maxLength={200}
                aria-label="Item name"
              />
              <button
                id="add-item-btn"
                className="btn btn-primary"
                type="submit"
                disabled={loading || !inputName.trim()}
              >
                {loading ? <span className="spinner" /> : '+'}
                {loading ? 'Adding...' : 'Add Item'}
              </button>
              <button
                id="refresh-btn"
                type="button"
                className="btn btn-ghost"
                onClick={fetchItems}
                disabled={fetching}
                title="Refresh list"
              >
                {fetching ? <span className="spinner" style={{ borderTopColor: 'currentColor' }} /> : 'Refresh'}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="section">
        <div className="section-header">
          <h2>Items</h2>
          {items.length > 0 && <span className="count">{items.length}</span>}
        </div>

        {fetching && items.length === 0 ? (
          <div className="empty-state">
            <p>Loading items from database...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <p>No items yet. Add your first item above!</p>
          </div>
        ) : (
          <div className="items-list" role="list">
            {items.map((item, i) => (
              <ItemCard key={item.id} item={item} index={i} />
            ))}
          </div>
        )}
      </section>

      <Toast toasts={toasts} />
    </div>
  );
}
