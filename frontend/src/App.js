import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import "./App.css";

const ACCESS_TOKEN_KEY = "finance_manager_access_token";
const REFRESH_TOKEN_KEY = "finance_manager_refresh_token";
const ACCESS_FALLBACK_KEY = "access";
const REFRESH_FALLBACK_KEY = "refresh";

function parseListPayload(payload) {
  const data = payload?.data;
  if (!data) {
    return [];
  }
  if (Array.isArray(data)) {
    return data;
  }
  if (Array.isArray(data.results)) {
    return data.results;
  }
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

    if (value === null || value === undefined || value === "") {
      return [];
    }

    return [parentKey ? `${parentKey}: ${String(value)}` : String(value)];
  };

  const errorDetails = formatErrors(errors);

  if (typeof message === "string" && message.trim()) {
    return errorDetails.length > 0
      ? `${message} Details: ${errorDetails.join(" | ")}`
      : message;
  }

  const detail = responseData?.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  if (errorDetails.length > 0) {
    return `${fallbackMessage} Details: ${errorDetails.join(" | ")}`;
  }

  return fallbackMessage;
}

function getStoredAccessToken() {
  return (
    localStorage.getItem(ACCESS_FALLBACK_KEY) ||
    localStorage.getItem(ACCESS_TOKEN_KEY) ||
    ""
  );
}

function AuthLayout({ subtitle, children, footer }) {
  return (
    <div className="auth-page">
      <div className="auth-content">
        <h1 className="auth-title">Finance Manager</h1>
        <h2 className="auth-subtitle">{subtitle}</h2>
        {children}
        {footer}
      </div>
    </div>
  );
}

function LoginPage({ api, onLogin }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState(location.state?.successMessage || "");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (location.state?.successMessage) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, location.state, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post("/auth/token/", form);
      const tokenData = res.data?.data || res.data;
      onLogin(tokenData?.access || "", tokenData?.refresh || "");
      navigate("/dashboard");
    } catch (err) {
      setError(getApiErrorMessage(err, "Invalid username or password"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      subtitle="Login"
      footer={
        <>
          <button
            type="button"
            className="auth-link-button"
            onClick={() => window.alert("Forgot password flow coming soon.")}
          >
            Forgot password?
          </button>
          <div className="auth-divider" />
          <button
            type="button"
            className="auth-button auth-button--secondary"
            onClick={() => navigate("/register")}
          >
            Create new account
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <input
          className="auth-input"
          placeholder="Username"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          autoComplete="username"
        />
        <div className="password-field">
          <input
            className="auth-input password-field__input"
            placeholder="Password"
            type={showPassword ? "text" : "password"}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="current-password"
          />
          <button
            type="button"
            className="password-field__toggle"
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <button className="auth-button" type="submit" disabled={loading}>
          {loading ? "Logging in..." : "Log in"}
        </button>
        {error && <p className="auth-message">{error}</p>}
      </form>
    </AuthLayout>
  );
}

function RegisterPage({ api }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    username: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await api.post("/auth/register/", {
        username: form.username,
        password: form.password,
        confirmPassword: form.confirmPassword,
      });
      navigate("/login", {
        state: { successMessage: "User created successfully. Please log in." },
      });
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to create user"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      subtitle="Create User"
      footer={
        <p className="auth-footer-text">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <input
          className="auth-input"
          placeholder="New username"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          autoComplete="username"
        />
        <div className="password-field">
          <input
            className="auth-input password-field__input"
            placeholder="New password"
            type={showPassword ? "text" : "password"}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="new-password"
          />
          <button
            type="button"
            className="password-field__toggle"
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <div className="password-field">
          <input
            className="auth-input password-field__input"
            placeholder="Confirm password"
            type={showConfirmPassword ? "text" : "password"}
            value={form.confirmPassword}
            onChange={(e) =>
              setForm({ ...form, confirmPassword: e.target.value })
            }
            autoComplete="new-password"
          />
          <button
            type="button"
            className="password-field__toggle"
            onClick={() => setShowConfirmPassword((current) => !current)}
          >
            {showConfirmPassword ? "Hide" : "Show"}
          </button>
        </div>
        <button className="auth-button" type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create user"}
        </button>
        {error && <p className="auth-message">{error}</p>}
      </form>
    </AuthLayout>
  );
}

function DashboardPage({ onLogout }) {
  const navigate = useNavigate();

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div>
          <h1 className="auth-title">Finance Manager</h1>
          <h2 className="dashboard-subtitle">Dashboard</h2>
        </div>
        <button
          type="button"
          className="auth-button auth-button--secondary dashboard-logout"
          onClick={() => {
            onLogout();
            navigate("/login");
          }}
        >
          Logout
        </button>
      </div>
      <section className="dashboard-cards">
        <button
          type="button"
          className="dashboard-card dashboard-card--borrow"
          onClick={() => navigate("/borrow")}
        >
          <span className="dashboard-card__icon">↓</span>
          <span className="dashboard-card__title">Borrow</span>
          <span className="dashboard-card__subtitle">Track money you borrowed</span>
        </button>

        <button
          type="button"
          className="dashboard-card dashboard-card--lend"
          onClick={() => navigate("/lend")}
        >
          <span className="dashboard-card__icon">↑</span>
          <span className="dashboard-card__title">Lend</span>
          <span className="dashboard-card__subtitle">Track money you lent out</span>
        </button>
      </section>
    </div>
  );
}

function RecordsPage({ api, type, title, subtitle, totalLabel, onLogout }) {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [form, setForm] = useState({
    person_name: "",
    amount: "",
    due_date: "",
    notes: "",
    status: "Pending",
  });

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${getStoredAccessToken()}`,
    }),
    []
  );

  const endpoint = `/${type}/`;

  const fetchRecords = useCallback(async () => {
    try {
      const res = await api.get(endpoint, { headers: authHeaders });
      setRecords(parseListPayload(res.data));
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, `Failed to fetch ${type} records.`));
    }
  }, [api, authHeaders, endpoint, type]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const resetForm = () => {
    setForm({
      person_name: "",
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
        amount: Number(form.amount),
        due_date: form.due_date,
        notes: form.notes,
        status: form.status,
      };

      if (editingId) {
        await api.put(`${endpoint}${editingId}/`, payload, { headers: authHeaders });
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
      amount: record.amount || "",
      due_date: record.due_date || "",
      notes: record.notes || "",
      status: record.status || "Pending",
    });
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
    .filter((record) => String(record.status || "").toLowerCase() === "pending")
    .reduce((sum, record) => sum + Number(record.amount || 0), 0);

  return (
    <div className="records-page">
      <div className="dashboard-header">
        <div className="records-header-left">
          <button
            type="button"
            className="back-button"
            onClick={() => navigate("/dashboard")}
          >
            ←
          </button>
          <div>
            <h1 className="auth-title">Finance Manager</h1>
            <h2 className="dashboard-subtitle">{title}</h2>
          </div>
        </div>
        <button
          type="button"
          className="auth-button auth-button--secondary dashboard-logout"
          onClick={() => {
            onLogout();
            navigate("/login");
          }}
        >
          Logout
        </button>
      </div>

      <div className="records-toolbar">
        <h3 className="dashboard-section-title">{subtitle}</h3>
        <button
          type="button"
          className="auth-button records-add-button"
          onClick={() => {
            setShowForm((current) => !current);
            if (showForm) {
              resetForm();
            }
          }}
        >
          + Add New
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="dashboard-form records-form">
          <input
            className="auth-input"
            placeholder="Person name"
            value={form.person_name}
            onChange={(e) => setForm({ ...form, person_name: e.target.value })}
            required
          />
          <input
            className="auth-input"
            placeholder="Amount"
            type="number"
            min={0}
            step="any"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />
          <input
            className="auth-input"
            type="date"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            required
          />
          <textarea
            className="auth-input records-textarea"
            placeholder="Notes or reason"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <select
            className="auth-input"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            <option value="Pending">Pending</option>
            <option value="Returned">Returned</option>
          </select>
          <div className="records-form-actions">
            <button className="auth-button" type="submit">
              {editingId ? "Update" : "Submit"}
            </button>
            <button
              type="button"
              className="auth-button auth-button--secondary"
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

      {errorMessage && <p className="auth-message">{errorMessage}</p>}

      <div className="records-total">
        {totalLabel}: ₹{totalPendingAmount.toFixed(2)}
      </div>

      <div className="records-list">
        {records.length === 0 && <p className="records-empty">No records found.</p>}
        {records.map((record) => {
          const normalizedStatus = String(record.status || "").toLowerCase();
          const statusClass =
            normalizedStatus === "returned"
              ? "status-badge status-badge--returned"
              : "status-badge status-badge--pending";

          return (
            <div key={record.id} className="record-item">
              <div className="record-row">
                <span className="loan-label">Person</span>
                <span className="loan-value">{record.person_name}</span>
              </div>
              <div className="record-row">
                <span className="loan-label">Amount</span>
                <span className="loan-value">₹{record.amount}</span>
              </div>
              <div className="record-row">
                <span className="loan-label">Due Date</span>
                <span className="loan-value">{record.due_date}</span>
              </div>
              <div className="record-row">
                <span className="loan-label">Notes</span>
                <span className="loan-value">{record.notes || "-"}</span>
              </div>
              <div className="record-row">
                <span className="loan-label">Status</span>
                <span className={statusClass}>{record.status}</span>
              </div>
              <div className="record-actions">
                <button
                  type="button"
                  className="auth-button auth-button--secondary record-action-button"
                  onClick={() => handleEdit(record)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="auth-button record-action-button record-action-button--danger"
                  onClick={() => handleDelete(record.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
    () => getStoredAccessToken()
  );

  const handleLogin = (access, refresh) => {
    setAccessToken(access);
    localStorage.setItem(ACCESS_TOKEN_KEY, access);
    localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
    localStorage.setItem(ACCESS_FALLBACK_KEY, access);
    localStorage.setItem(REFRESH_FALLBACK_KEY, refresh);
  };

  const handleLogout = () => {
    setAccessToken("");
    localStorage.clear();
  };

  return (
    <Routes>
      <Route
        path="/login"
        element={
          accessToken ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <LoginPage api={api} onLogin={handleLogin} />
          )
        }
      />
      <Route
        path="/register"
        element={
          accessToken ? <Navigate to="/dashboard" replace /> : <RegisterPage api={api} />
        }
      />
      <Route
        path="/dashboard"
        element={
          accessToken ? (
            <DashboardPage onLogout={handleLogout} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/borrow"
        element={
          accessToken ? (
            <RecordsPage
              api={api}
              type="borrow"
              title="Borrow Records"
              subtitle="Borrow Records"
              totalLabel="Total Borrowed (Pending)"
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
            <RecordsPage
              api={api}
              type="lend"
              title="Lend Records"
              subtitle="Lend Records"
              totalLabel="Total Lent (Pending)"
              onLogout={handleLogout}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="*"
        element={<Navigate to={accessToken ? "/dashboard" : "/login"} replace />}
      />
    </Routes>
  );
}

export default App;