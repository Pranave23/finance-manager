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

function DashboardPage({ api, accessToken, onLogout }) {
  const navigate = useNavigate();
  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${accessToken}`,
    }),
    [accessToken]
  );
  const [contacts, setContacts] = useState([]);
  const [loans, setLoans] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [form, setForm] = useState({
    contact: "",
    name: "",
    phone_number: "",
    aadhaar_number: "",
    principal_amount: "",
    interest_rate: "",
    direction: "borrowing",
    interest_period: "monthly",
    start_date: new Date().toISOString().split("T")[0],
    notes: "",
  });

  const fetchContacts = useCallback(async () => {
    try {
      const res = await api.get("/contacts/", { headers: authHeaders });
      setContacts(parseListPayload(res.data));
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to fetch contacts."));
    }
  }, [api, authHeaders]);

  const fetchLoans = useCallback(async () => {
    try {
      const res = await api.get("/loans/", { headers: authHeaders });
      setLoans(parseListPayload(res.data));
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to fetch loans."));
    }
  }, [api, authHeaders]);

  useEffect(() => {
    fetchContacts();
    fetchLoans();
  }, [fetchContacts, fetchLoans]);

  const resolveContactId = async () => {
    if (form.contact) {
      return form.contact;
    }

    const res = await api.post(
      "/contacts/",
      {
        name: form.name,
        phone_number: form.phone_number,
        aadhaar_number: form.aadhaar_number,
        type: form.direction === "borrowing" ? "lender" : "borrower",
      },
      { headers: authHeaders }
    );

    const contact = res.data?.data || res.data;
    return contact?.id;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage("");

    try {
      const contactId = await resolveContactId();
      await api.post(
        "/loans/",
        {
          contact: contactId,
          direction: form.direction,
          principal_amount: Number(form.principal_amount),
          interest_rate: Number(form.interest_rate),
          interest_period: form.interest_period,
          start_date: form.start_date,
          notes: form.notes,
        },
        { headers: authHeaders }
      );

      await fetchContacts();
      await fetchLoans();
      setForm({
        contact: "",
        name: "",
        phone_number: "",
        aadhaar_number: "",
        principal_amount: "",
        interest_rate: "",
        direction: "borrowing",
        interest_period: "monthly",
        start_date: new Date().toISOString().split("T")[0],
        notes: "",
      });
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to create loan."));
    }
  };

  const borrowLoans = loans.filter((loan) => loan.direction === "borrowing");
  const lendLoans = loans.filter((loan) => loan.direction === "lending");

  const getInterestAmount = (loan) => {
    const principal = Number(loan.principal_amount ?? 0);
    const rate = Number(loan.interest_rate ?? 0);
    return ((principal * rate) / 100).toFixed(2);
  };

  const formatPeriodLabel = (period) => {
    switch (period) {
      case "daily":
        return "per day";
      case "weekly":
        return "per week";
      case "monthly":
        return "per month";
      default:
        return period || "";
    }
  };

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

      {errorMessage && <p className="auth-message">{errorMessage}</p>}

      <section className="dashboard-section">
        <h3 className="dashboard-section-title">Add Loan</h3>
        <form onSubmit={handleSubmit} className="dashboard-form">
          <select
            className="auth-input"
            value={form.contact}
            onChange={(e) => setForm({ ...form, contact: e.target.value })}
          >
            <option value="">Create new contact</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>

          {!form.contact && (
            <>
              <input
                className="auth-input"
                placeholder="Contact name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <input
                className="auth-input"
                placeholder="Phone number"
                value={form.phone_number}
                onChange={(e) =>
                  setForm({ ...form, phone_number: e.target.value })
                }
              />
              <input
                className="auth-input"
                placeholder="Aadhaar number"
                value={form.aadhaar_number}
                onChange={(e) =>
                  setForm({ ...form, aadhaar_number: e.target.value })
                }
              />
            </>
          )}

          <input
            className="auth-input"
            placeholder="Principal amount"
            type="number"
            value={form.principal_amount}
            onChange={(e) =>
              setForm({ ...form, principal_amount: e.target.value })
            }
            min={0}
            step="any"
          />
          <input
            className="auth-input"
            placeholder="Interest %"
            type="number"
            value={form.interest_rate}
            onChange={(e) => setForm({ ...form, interest_rate: e.target.value })}
            min={0}
            step="any"
          />
          <input
            className="auth-input"
            type="date"
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
          />
          <select
            className="auth-input"
            value={form.interest_period}
            onChange={(e) =>
              setForm({ ...form, interest_period: e.target.value })
            }
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <select
            className="auth-input"
            value={form.direction}
            onChange={(e) => setForm({ ...form, direction: e.target.value })}
          >
            <option value="borrowing">Borrow</option>
            <option value="lending">Lend</option>
          </select>
          <input
            className="auth-input"
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />

          <button className="auth-button" type="submit">
            Add Loan
          </button>
        </form>
      </section>

      <section className="loan-lists-container">
        <div className="loan-column">
          <h3 className="dashboard-section-title">Borrowed Loans</h3>
          <ul className="loan-list">
            {borrowLoans.length === 0 && <li className="loan-item">No borrowed loans</li>}
            {borrowLoans.map((loan) => (
              <li key={loan.id} className="loan-item">
                <div className="loan-card">
                  <div className="loan-title-row">
                    <span className="loan-type loan-type--borrow">Borrow</span>
                  </div>
                  <div className="loan-meta-row">
                    <span className="loan-label">Name:</span>
                    <span className="loan-value">{loan.contact?.name || "N/A"}</span>
                  </div>
                  <div className="loan-meta-row">
                    <span className="loan-label">Amount:</span>
                    <span className="loan-value">₹{loan.principal_amount}</span>
                  </div>
                  <div className="loan-meta-row">
                    <span className="loan-label">Interest:</span>
                    <span className="loan-value">{loan.interest_rate}%</span>
                  </div>
                  <div className="loan-meta-row">
                    <span className="loan-label">Period:</span>
                    <span className="loan-value">
                      {loan.interest_period} {formatPeriodLabel(loan.interest_period)}
                    </span>
                  </div>
                  <div className="loan-meta-row">
                    <span className="loan-label">Interest amount:</span>
                    <span className="loan-value">₹{getInterestAmount(loan)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="loan-column">
          <h3 className="dashboard-section-title">Lent Loans</h3>
          <ul className="loan-list">
            {lendLoans.length === 0 && <li className="loan-item">No lent loans</li>}
            {lendLoans.map((loan) => (
              <li key={loan.id} className="loan-item">
                <div className="loan-card">
                  <div className="loan-title-row">
                    <span className="loan-type loan-type--lend">Lend</span>
                  </div>
                  <div className="loan-meta-row">
                    <span className="loan-label">Name:</span>
                    <span className="loan-value">{loan.contact?.name || "N/A"}</span>
                  </div>
                  <div className="loan-meta-row">
                    <span className="loan-label">Amount:</span>
                    <span className="loan-value">₹{loan.principal_amount}</span>
                  </div>
                  <div className="loan-meta-row">
                    <span className="loan-label">Interest:</span>
                    <span className="loan-value">{loan.interest_rate}%</span>
                  </div>
                  <div className="loan-meta-row">
                    <span className="loan-label">Period:</span>
                    <span className="loan-value">
                      {loan.interest_period} {formatPeriodLabel(loan.interest_period)}
                    </span>
                  </div>
                  <div className="loan-meta-row">
                    <span className="loan-label">Interest amount:</span>
                    <span className="loan-value">₹{getInterestAmount(loan)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
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
    () => localStorage.getItem(ACCESS_TOKEN_KEY) || ""
  );

  const handleLogin = (access, refresh) => {
    setAccessToken(access);
    localStorage.setItem(ACCESS_TOKEN_KEY, access);
    localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  };

  const handleLogout = () => {
    setAccessToken("");
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
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
            <DashboardPage
              api={api}
              accessToken={accessToken}
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