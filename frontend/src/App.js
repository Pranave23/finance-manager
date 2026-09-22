import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import "./App.css";

const ACCESS_TOKEN_KEY = "fm_access_token";
const REFRESH_TOKEN_KEY = "fm_refresh_token";
const USER_MOBILE_KEY = "fm_user_mobile";

function parseListPayload(payload) {
  const data = payload?.data;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

function getApiErrorMessage(err, fallbackMessage) {
  const responseData = err?.response?.data;
  const message = responseData?.message;
  const errors = responseData?.errors;

  const formatErrors = (value, parentKey = "") => {
    if (Array.isArray(value)) {
      return value
        .flatMap((item) => formatErrors(item, parentKey))
        .filter(Boolean);
    }
    if (value && typeof value === "object") {
      return Object.entries(value).flatMap(([key, nestedValue]) =>
        formatErrors(nestedValue, parentKey ? `${parentKey}.${key}` : key)
      );
    }
    if (value === null || value === undefined || value === "") return [];
    return [parentKey ? `${parentKey}: ${String(value)}` : String(value)];
  };

  const errorDetails = formatErrors(errors);
  if (typeof message === "string" && message.trim()) {
    return errorDetails.length > 0
      ? `${message} (${errorDetails.join(" | ")})`
      : message;
  }
  if (errorDetails.length > 0) {
    return `${fallbackMessage} (${errorDetails.join(" | ")})`;
  }
  return fallbackMessage;
}

function AuthPage({ api, onLogin }) {
  const navigate = useNavigate();
  const [isSignUp, setIsSignUp] = useState(false);
  const [mobileNumber, setMobileNumber] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!mobileNumber || mobileNumber.length < 7) {
      setMessage({
        text: "Please enter a valid mobile number.",
        type: "error",
      });
      return;
    }
    if (!password) {
      setMessage({
        text: "Please enter your password.",
        type: "error",
      });
      return;
    }

    setLoading(true);
    setMessage({ text: "", type: "" });
    const endpoint = isSignUp ? "/auth/register/" : "/auth/login/";

    try {
      const res = await api.post(endpoint, {
        mobile_number: mobileNumber,
        password,
      });

      const tokenData = res.data?.data;
      if (tokenData?.access) {
        onLogin(tokenData.access, tokenData.refresh, mobileNumber);
        navigate("/borrow");
      } else {
        setMessage({
          text: "Registration successful! You can now sign in.",
          type: "success",
        });
        setTimeout(() => {
          setIsSignUp(false);
        }, 1000);
      }
    } catch (err) {
      setMessage({
        text: getApiErrorMessage(
          err,
          isSignUp ? "Sign up failed." : "Login failed."
        ),
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo-icon">💰</div>
          <h1 className="auth-title">Finance Manager</h1>
          <p className="auth-subtitle">
            {isSignUp
              ? "Register with Mobile Number & Password"
              : "Sign in with Mobile Number & Password"}
          </p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${!isSignUp ? "active" : ""}`}
            onClick={() => {
              setIsSignUp(false);
              setMessage({ text: "", type: "" });
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`auth-tab ${isSignUp ? "active" : ""}`}
            onClick={() => {
              setIsSignUp(true);
              setMessage({ text: "", type: "" });
            }}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>Mobile Number</label>
            <input
              type="tel"
              className="form-input"
              placeholder="e.g. 9876543210"
              value={mobileNumber}
              onChange={(e) => setMobileNumber(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              className="form-input"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {message.text && (
            <div className={`auth-alert auth-alert--${message.type}`}>
              {message.text}
            </div>
          )}

          <button type="submit" className="primary-btn" disabled={loading}>
            {loading
              ? "Processing..."
              : isSignUp
              ? "Create Account"
              : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

function PortalLayout({ userMobile, activeTab, onLogout, children }) {
  const navigate = useNavigate();

  return (
    <div className="portal-container">
      <header className="portal-header">
        <div className="header-brand">
          <span className="brand-logo">💸</span>
          <div>
            <h1 className="brand-title">Finance Manager</h1>
            <span className="user-badge">📱 {userMobile || "User"}</span>
          </div>
        </div>

        <nav className="portal-nav">
          <button
            type="button"
            className={`nav-tab nav-tab--borrow ${
              activeTab === "borrow" ? "active" : ""
            }`}
            onClick={() => navigate("/borrow")}
          >
            ↓ Borrow Portal
          </button>
          <button
            type="button"
            className={`nav-tab nav-tab--lend ${
              activeTab === "lend" ? "active" : ""
            }`}
            onClick={() => navigate("/lend")}
          >
            ↑ Lend Portal
          </button>
        </nav>

        <button type="button" className="logout-btn" onClick={onLogout}>
          Logout
        </button>
      </header>

      <main className="portal-main">{children}</main>
    </div>
  );
}

function RecordPortal({ api, type, title, subtitle, totalLabel, userMobile, onLogout }) {
  const [records, setRecords] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [form, setForm] = useState({
    person_name: "",
    phone_number: "",
    amount: "",
    due_date: "",
    notes: "",
    status: "Pending",
  });

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${localStorage.getItem(ACCESS_TOKEN_KEY)}`,
    }),
    []
  );

  const endpoint = `/${type}/`;

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(endpoint, { headers: authHeaders });
      setRecords(parseListPayload(res.data));
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, `Failed to fetch ${type} records.`));
    } finally {
      setLoading(false);
    }
  }, [api, authHeaders, endpoint, type]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const resetForm = () => {
    setForm({
      person_name: "",
      phone_number: "",
      amount: "",
      due_date: "",
      notes: "",
      status: "Pending",
    });
    setEditingId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage("");
    try {
      const payload = {
        person_name: form.person_name,
        phone_number: form.phone_number,
        amount: Number(form.amount),
        due_date: form.due_date,
        notes: form.notes,
        status: form.status,
      };

      if (editingId) {
        await api.put(`${endpoint}${editingId}/`, payload, {
          headers: authHeaders,
        });
      } else {
        await api.post(endpoint, payload, { headers: authHeaders });
      }

      await fetchRecords();
      resetForm();
      setShowForm(false);
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, `Failed to save ${type} record.`));
    }
  };

  const handleEdit = (record) => {
    setShowForm(true);
    setEditingId(record.id);
    setForm({
      person_name: record.person_name || "",
      phone_number: record.phone_number || "",
      amount: record.amount || "",
      due_date: record.due_date || "",
      notes: record.notes || "",
      status: record.status || "Pending",
    });
  };

  const handleToggleStatus = async (record) => {
    const newStatus = record.status === "Pending" ? "Returned" : "Pending";
    try {
      await api.patch(
        `${endpoint}${record.id}/`,
        { status: newStatus },
        { headers: authHeaders }
      );
      fetchRecords();
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to update status."));
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this record?")) {
      return;
    }
    setErrorMessage("");
    try {
      await api.delete(`${endpoint}${id}/`, { headers: authHeaders });
      await fetchRecords();
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, `Failed to delete ${type} record.`));
    }
  };

  const totalPendingAmount = records
    .filter((r) => String(r.status || "").toLowerCase() === "pending")
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  return (
    <PortalLayout userMobile={userMobile} activeTab={type} onLogout={onLogout}>
      <div className="portal-banner">
        <div className="banner-info">
          <h2>{title}</h2>
          <p className="banner-subtitle">{subtitle}</p>
        </div>
        <div className="banner-stat">
          <span className="stat-label">{totalLabel}</span>
          <span className="stat-value">₹{totalPendingAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
        </div>
        <button
          type="button"
          className="action-btn"
          onClick={() => {
            setShowForm((prev) => !prev);
            if (showForm) resetForm();
          }}
        >
          {showForm ? "✕ Close Form" : `+ Add New ${type === "borrow" ? "Borrow" : "Lend"} Record`}
        </button>
      </div>

      {errorMessage && <div className="portal-error">{errorMessage}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="record-form-card">
          <h3>{editingId ? "Edit Record" : `New ${type === "borrow" ? "Borrow" : "Lend"} Entry`}</h3>
          <div className="form-grid">
            <div className="form-field">
              <label>Person Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. John Doe"
                value={form.person_name}
                onChange={(e) => setForm({ ...form, person_name: e.target.value })}
                required
              />
            </div>

            <div className="form-field">
              <label>Phone Number (optional)</label>
              <input
                type="tel"
                className="form-input"
                placeholder="e.g. 9876543210"
                value={form.phone_number}
                onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
              />
            </div>

            <div className="form-field">
              <label>Amount (₹)</label>
              <input
                type="number"
                className="form-input"
                placeholder="Amount"
                min={0}
                step="any"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
            </div>

            <div className="form-field">
              <label>Due Date</label>
              <input
                type="date"
                className="form-input"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                required
              />
            </div>

            <div className="form-field">
              <label>Status</label>
              <select
                className="form-input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="Pending">Pending</option>
                <option value="Returned">Returned</option>
              </select>
            </div>

            <div className="form-field full-width">
              <label>Notes / Reason</label>
              <textarea
                className="form-input"
                rows={2}
                placeholder="Optional notes or reason for this entry..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="primary-btn">
              {editingId ? "Save Changes" : "Create Record"}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="records-grid">
        {loading && <div className="loading-spinner">Loading records...</div>}
        {!loading && records.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon">📂</span>
            <h3>No {type} records found</h3>
            <p>Click the button above to add your first entry.</p>
          </div>
        )}

        {records.map((record) => {
          const isPending = record.status === "Pending";
          return (
            <div key={record.id} className={`record-card ${type}-card`}>
              <div className="card-top">
                <div className="person-info">
                  <h3 className="person-name">{record.person_name}</h3>
                  {record.phone_number && (
                    <span className="person-phone">📞 {record.phone_number}</span>
                  )}
                </div>
                <span
                  className={`status-pill ${
                    isPending ? "pill-pending" : "pill-returned"
                  }`}
                  onClick={() => handleToggleStatus(record)}
                  title="Click to toggle status"
                >
                  {record.status}
                </span>
              </div>

              <div className="card-body">
                <div className="amount-display">
                  <span className="amount-label">Amount:</span>
                  <span className="amount-value">₹{Number(record.amount).toLocaleString("en-IN")}</span>
                </div>
                <div className="due-display">
                  <span className="due-label">Due Date:</span>
                  <span className="due-value">{record.due_date}</span>
                </div>
                {record.notes && <p className="record-notes">"{record.notes}"</p>}
              </div>

              <div className="card-actions">
                <button
                  type="button"
                  className="card-btn card-btn--edit"
                  onClick={() => handleEdit(record)}
                >
                  ✏️ Edit
                </button>
                <button
                  type="button"
                  className="card-btn card-btn--delete"
                  onClick={() => handleDelete(record.id)}
                >
                  🗑️ Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </PortalLayout>
  );
}

function App() {
  const api = useMemo(
    () =>
      axios.create({
        baseURL: "http://127.0.0.1:8000/api/v1",
      }),
    []
  );

  const [accessToken, setAccessToken] = useState(
    () => localStorage.getItem(ACCESS_TOKEN_KEY) || ""
  );
  const [userMobile, setUserMobile] = useState(
    () => localStorage.getItem(USER_MOBILE_KEY) || ""
  );

  const handleLogin = (access, refresh, mobile) => {
    setAccessToken(access);
    setUserMobile(mobile);
    localStorage.setItem(ACCESS_TOKEN_KEY, access);
    localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
    localStorage.setItem(USER_MOBILE_KEY, mobile);
  };

  const handleLogout = () => {
    setAccessToken("");
    setUserMobile("");
    localStorage.clear();
  };

  return (
    <Routes>
      <Route
        path="/login"
        element={
          accessToken ? (
            <Navigate to="/borrow" replace />
          ) : (
            <AuthPage api={api} onLogin={handleLogin} />
          )
        }
      />
      <Route
        path="/borrow"
        element={
          accessToken ? (
            <RecordPortal
              api={api}
              type="borrow"
              title="Borrow Portal"
              subtitle="Track money you have borrowed from others"
              totalLabel="Total Borrowed (Pending)"
              userMobile={userMobile}
              onLogout={handleLogout}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/lend"
        element={
          accessToken ? (
            <RecordPortal
              api={api}
              type="lend"
              title="Lend Portal"
              subtitle="Track money you have lent to others"
              totalLabel="Total Lent (Pending)"
              userMobile={userMobile}
              onLogout={handleLogout}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="*"
        element={<Navigate to={accessToken ? "/borrow" : "/login"} replace />}
      />
    </Routes>
  );
}

export default App;