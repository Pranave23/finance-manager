import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

const ACCESS_TOKEN_KEY = "fm_access_token";

function parseListPayload(payload) {
  const data = payload?.data;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

function parseObjectPayload(payload) {
  const data = payload?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) return data;
  return payload?.data ?? null;
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

function formatMoney(value, currency = "INR") {
  const num = Number(value || 0);
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${num.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

function formatInterestInfo(row) {
  if (!row || row.interest_type === "None") return "None";
  if (row.interest_type === "Manual") {
    return `Manual (${formatMoney(row.manual_interest_amount, row.currency)})`;
  }
  if (row.interest_type === "Simple") {
    return `Simple (${row.interest_rate}% / ${row.rate_period || "mo"})`;
  }
  if (row.interest_type === "Compound") {
    return `Compound (${row.interest_rate}% / ${row.rate_period || "yr"} compounded ${row.compounding_frequency || "mo"})`;
  }
  return row.interest_type;
}

const EMPTY_BORROW_FORM = {
  lender_mode: "existing",
  lender_id: "",
  new_lender_name: "",
  new_lender_phone: "",
  new_lender_email: "",
  new_lender_notes: "",
  principal_amount: "",
  currency: "INR",
  borrowed_date: new Date().toISOString().slice(0, 10),
  is_open_ended: false,
  due_date: "",
  interest_type: "None",
  interest_rate: "",
  rate_period: "monthly",
  compounding_frequency: "monthly",
  manual_interest_amount: "",
  repayment_schedule_type: "one_time",
  notes: "",
};

const EMPTY_PAYMENT_FORM = {
  amount_paid: "",
  payment_date: new Date().toISOString().slice(0, 10),
  notes: "",
};

export default function BorrowPortal({ api, PortalLayout, userMobile, onLogout }) {
  const [borrows, setBorrows] = useState([]);
  const [lenders, setLenders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [paymentBorrow, setPaymentBorrow] = useState(null);
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT_FORM);
  const [form, setForm] = useState(EMPTY_BORROW_FORM);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${localStorage.getItem(ACCESS_TOKEN_KEY)}`,
    }),
    []
  );

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const [borrowRes, lenderRes, summaryRes] = await Promise.all([
        api.get("/borrow/", { headers: authHeaders }),
        api.get("/lenders/", { headers: authHeaders }),
        api.get("/borrow/summary/", { headers: authHeaders }),
      ]);
      setBorrows(parseListPayload(borrowRes.data));
      setLenders(parseListPayload(lenderRes.data));
      setSummary(parseObjectPayload(summaryRes.data));
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to load borrow data."));
    } finally {
      setLoading(false);
    }
  }, [api, authHeaders]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const resetForm = () => {
    setForm(EMPTY_BORROW_FORM);
    setEditingId(null);
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setShowForm(true);
    setForm({
      lender_mode: "existing",
      lender_id: row.lender?.id || "",
      new_lender_name: "",
      new_lender_phone: "",
      new_lender_email: "",
      new_lender_notes: "",
      principal_amount: row.principal_amount,
      currency: row.currency || "INR",
      borrowed_date: row.borrowed_date,
      is_open_ended: !row.due_date,
      due_date: row.due_date || "",
      interest_type: row.interest_type,
      interest_rate: row.interest_rate ?? "",
      rate_period: row.rate_period || "monthly",
      compounding_frequency: row.compounding_frequency || "monthly",
      manual_interest_amount: row.manual_interest_amount ?? "",
      repayment_schedule_type: row.repayment_schedule_type || "one_time",
      notes: row.notes || "",
    });
  };

  const buildBorrowPayload = async () => {
    let lenderId = form.lender_id;
    if (form.lender_mode === "new") {
      const lenderRes = await api.post(
        "/lenders/",
        {
          name: form.new_lender_name,
          phone: form.new_lender_phone,
          email: form.new_lender_email || "",
          notes: form.new_lender_notes || "",
        },
        { headers: authHeaders }
      );
      const lender = parseObjectPayload(lenderRes.data);
      lenderId = lender.id;
    }

    const payload = {
      lender_id: lenderId,
      principal_amount: Number(form.principal_amount),
      currency: form.currency,
      borrowed_date: form.borrowed_date,
      due_date: form.is_open_ended ? null : form.due_date || null,
      interest_type: form.interest_type,
      rate_period: form.rate_period,
      repayment_schedule_type: form.repayment_schedule_type,
      notes: form.notes,
    };

    if (form.interest_type === "Simple" || form.interest_type === "Compound") {
      payload.interest_rate = Number(form.interest_rate);
    } else {
      payload.interest_rate = null;
    }

    if (form.interest_type === "Compound") {
      payload.compounding_frequency = form.compounding_frequency;
    } else {
      payload.compounding_frequency = "";
    }

    if (form.interest_type === "Manual") {
      payload.manual_interest_amount = Number(form.manual_interest_amount);
    } else {
      payload.manual_interest_amount = null;
    }

    return payload;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage("");
    try {
      const payload = await buildBorrowPayload();
      if (editingId) {
        await api.put(`/borrow/${editingId}/`, payload, { headers: authHeaders });
      } else {
        await api.post("/borrow/", payload, { headers: authHeaders });
      }
      await fetchAll();
      resetForm();
      setShowForm(false);
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to save borrow."));
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this borrow record? This cannot be undone.")) return;
    try {
      await api.delete(`/borrow/${id}/`, { headers: authHeaders });
      await fetchAll();
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to delete borrow."));
    }
  };

  const submitPayment = async (e) => {
    e.preventDefault();
    if (!paymentBorrow) return;
    setErrorMessage("");
    try {
      await api.post(
        `/borrow/${paymentBorrow.id}/payments/`,
        {
          amount_paid: Number(paymentForm.amount_paid),
          payment_date: paymentForm.payment_date,
          notes: paymentForm.notes,
        },
        { headers: authHeaders }
      );
      setPaymentBorrow(null);
      setPaymentForm(EMPTY_PAYMENT_FORM);
      await fetchAll();
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to record payment."));
    }
  };

  const deletePayment = async (borrowId, paymentId) => {
    if (!window.confirm("Delete this payment entry?")) return;
    try {
      await api.delete(`/borrow/${borrowId}/payments/${paymentId}/`, {
        headers: authHeaders,
      });
      await fetchAll();
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to delete payment."));
    }
  };

  return (
    <PortalLayout userMobile={userMobile} activeTab="borrow" onLogout={onLogout}>
      {/* Dashboard Summary Cards */}
      <div className="borrow-summary-grid">
        <div className="summary-card">
          <span className="summary-card__label">Total Borrowed</span>
          <span className="summary-card__value">
            {formatMoney(summary?.total_borrowed)}
          </span>
          <span className="summary-card__sub">Principal across all loans</span>
        </div>
        <div className="summary-card">
          <span className="summary-card__label">Total Outstanding</span>
          <span className="summary-card__value summary-card__value--warn">
            {formatMoney(summary?.total_outstanding)}
          </span>
          <span className="summary-card__sub">Remaining balance to date</span>
        </div>
        <div className="summary-card">
          <span className="summary-card__label">Total Paid</span>
          <span className="summary-card__value summary-card__value--good">
            {formatMoney(summary?.total_paid)}
          </span>
          <span className="summary-card__sub">Sum of all payments made</span>
        </div>
        <div className="summary-card">
          <span className="summary-card__label">Overdue Loans</span>
          <span className="summary-card__value summary-card__value--danger">
            {summary?.overdue_count ?? 0}
          </span>
          <span className="summary-card__sub">Passed due date & unpaid</span>
        </div>
      </div>

      <div className="portal-banner">
        <div className="banner-info">
          <h2>Borrow Management</h2>
          <p className="banner-subtitle">
            Track borrowed loans, interest calculations, payments, and schedules
          </p>
        </div>
        <button
          type="button"
          className="action-btn"
          onClick={() => {
            setShowForm((prev) => !prev);
            if (showForm) resetForm();
          }}
        >
          {showForm ? "✕ Close Form" : "+ Add Borrow"}
        </button>
      </div>

      {errorMessage && <div className="portal-error">{errorMessage}</div>}

      {/* Add/Edit Borrow Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="record-form-card">
          <h3>{editingId ? "Edit Borrow" : "New Borrow Entry"}</h3>
          <div className="form-grid">
            {!editingId && (
              <div className="form-field full-width">
                <label>Lender Source</label>
                <div className="radio-group">
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="lender_mode"
                      value="existing"
                      checked={form.lender_mode === "existing"}
                      onChange={() => setForm({ ...form, lender_mode: "existing" })}
                    />
                    Select Existing Lender
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="lender_mode"
                      value="new"
                      checked={form.lender_mode === "new"}
                      onChange={() => setForm({ ...form, lender_mode: "new" })}
                    />
                    + Create New Lender
                  </label>
                </div>
              </div>
            )}

            {form.lender_mode === "existing" || editingId ? (
              <div className="form-field">
                <label>Select Lender</label>
                <select
                  className="form-input"
                  value={form.lender_id}
                  onChange={(e) =>
                    setForm({ ...form, lender_id: e.target.value })
                  }
                  required
                >
                  <option value="">-- Choose a lender --</option>
                  {lenders.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.phone})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div className="form-field">
                  <label>Lender Name *</label>
                  <input
                    className="form-input"
                    placeholder="e.g. Acme Finance / John Doe"
                    value={form.new_lender_name}
                    onChange={(e) =>
                      setForm({ ...form, new_lender_name: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Lender Phone *</label>
                  <input
                    className="form-input"
                    placeholder="e.g. 9876543210"
                    value={form.new_lender_phone}
                    onChange={(e) =>
                      setForm({ ...form, new_lender_phone: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Lender Email (optional)</label>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="lender@example.com"
                    value={form.new_lender_email}
                    onChange={(e) =>
                      setForm({ ...form, new_lender_email: e.target.value })
                    }
                  />
                </div>
                <div className="form-field">
                  <label>Lender Notes (optional)</label>
                  <input
                    className="form-input"
                    placeholder="Contact notes..."
                    value={form.new_lender_notes}
                    onChange={(e) =>
                      setForm({ ...form, new_lender_notes: e.target.value })
                    }
                  />
                </div>
              </>
            )}

            <div className="form-field">
              <label>Principal Amount (₹) *</label>
              <input
                type="number"
                min={0}
                step="any"
                className="form-input"
                placeholder="10000"
                value={form.principal_amount}
                onChange={(e) =>
                  setForm({ ...form, principal_amount: e.target.value })
                }
                required
              />
            </div>

            <div className="form-field">
              <label>Borrowed Date *</label>
              <input
                type="date"
                className="form-input"
                value={form.borrowed_date}
                onChange={(e) =>
                  setForm({ ...form, borrowed_date: e.target.value })
                }
                required
              />
            </div>

            <div className="form-field">
              <label>
                Due Date{" "}
                <span className="hint-text">(optional for open-ended loans)</span>
              </label>
              <div className="due-date-field-wrap">
                <input
                  type="date"
                  className="form-input"
                  disabled={form.is_open_ended}
                  value={form.is_open_ended ? "" : form.due_date}
                  onChange={(e) =>
                    setForm({ ...form, due_date: e.target.value })
                  }
                />
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.is_open_ended}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        is_open_ended: e.target.checked,
                        due_date: e.target.checked ? "" : form.due_date,
                      })
                    }
                  />
                  Open-ended loan
                </label>
              </div>
            </div>

            <div className="form-field">
              <label>Interest Type</label>
              <select
                className="form-input"
                value={form.interest_type}
                onChange={(e) =>
                  setForm({ ...form, interest_type: e.target.value })
                }
              >
                <option value="None">None (0% Interest)</option>
                <option value="Simple">Simple Interest</option>
                <option value="Compound">Compound Interest</option>
                <option value="Manual">Manual Interest Amount</option>
              </select>
            </div>

            {(form.interest_type === "Simple" ||
              form.interest_type === "Compound") && (
              <>
                <div className="form-field">
                  <label>Interest Rate (%) *</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 5"
                    className="form-input"
                    value={form.interest_rate}
                    onChange={(e) =>
                      setForm({ ...form, interest_rate: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Rate Period</label>
                  <select
                    className="form-input"
                    value={form.rate_period}
                    onChange={(e) =>
                      setForm({ ...form, rate_period: e.target.value })
                    }
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </>
            )}

            {form.interest_type === "Compound" && (
              <div className="form-field">
                <label>Compounding Frequency *</label>
                <select
                  className="form-input"
                  value={form.compounding_frequency}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      compounding_frequency: e.target.value,
                    })
                  }
                  required
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
            )}

            {form.interest_type === "Manual" && (
              <div className="form-field">
                <label>Manual Interest Amount (₹) *</label>
                <input
                  type="number"
                  step="any"
                  placeholder="e.g. 500"
                  className="form-input"
                  value={form.manual_interest_amount}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      manual_interest_amount: e.target.value,
                    })
                  }
                  required
                />
              </div>
            )}

            <div className="form-field">
              <label>Repayment Schedule Type</label>
              <select
                className="form-input"
                value={form.repayment_schedule_type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    repayment_schedule_type: e.target.value,
                  })
                }
              >
                <option value="one_time">One time (Bullet payment)</option>
                <option value="monthly">Monthly installments</option>
                <option value="weekly">Weekly installments</option>
                <option value="daily">Daily installments</option>
              </select>
            </div>

            <div className="form-field full-width">
              <label>Notes / Purpose</label>
              <textarea
                className="form-input"
                rows={2}
                placeholder="Loan reason, collateral notes, or agreement terms..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="primary-btn">
              {editingId ? "Save Changes" : "Create Borrow Entry"}
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

      {/* Record Payment Dialog */}
      {paymentBorrow && (
        <form onSubmit={submitPayment} className="record-form-card payment-form-card">
          <div className="payment-form-header">
            <h3>Record Payment for {paymentBorrow.lender_name}</h3>
            <span className="remaining-badge">
              Remaining: {formatMoney(paymentBorrow.remaining_balance, paymentBorrow.currency)}
            </span>
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label>Amount Paid (₹) *</label>
              <input
                type="number"
                min={0}
                step="any"
                className="form-input"
                placeholder="Amount"
                value={paymentForm.amount_paid}
                onChange={(e) =>
                  setPaymentForm({ ...paymentForm, amount_paid: e.target.value })
                }
                required
              />
            </div>
            <div className="form-field">
              <label>Payment Date *</label>
              <input
                type="date"
                className="form-input"
                value={paymentForm.payment_date}
                onChange={(e) =>
                  setPaymentForm({
                    ...paymentForm,
                    payment_date: e.target.value,
                  })
                }
                required
              />
            </div>
            <div className="form-field full-width">
              <label>Payment Notes (optional)</label>
              <input
                className="form-input"
                placeholder="Reference #, UPI, bank transfer, or cash..."
                value={paymentForm.notes}
                onChange={(e) =>
                  setPaymentForm({ ...paymentForm, notes: e.target.value })
                }
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="primary-btn">
              Confirm Payment
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                setPaymentBorrow(null);
                setPaymentForm(EMPTY_PAYMENT_FORM);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Borrow Table */}
      <div className="borrow-table-wrap">
        {loading && <div className="loading-spinner">Loading borrow records...</div>}
        {!loading && borrows.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon">📂</span>
            <h3>No borrows recorded yet</h3>
            <p>Click "+ Add Borrow" above to create your first borrow record.</p>
          </div>
        )}

        {!loading && borrows.length > 0 && (
          <table className="borrow-table">
            <thead>
              <tr>
                <th aria-label="Expand" style={{ width: "36px" }} />
                <th>Lender Name</th>
                <th>Phone</th>
                <th>Principal</th>
                <th>Borrowed Date</th>
                <th>Due Date</th>
                <th>Interest Type</th>
                <th>Status</th>
                <th>Total Paid</th>
                <th>Remaining Balance</th>
                <th>Next Due Date</th>
                <th>Next Amount</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {borrows.map((row) => {
                const expanded = expandedId === row.id;
                const overdue = row.is_overdue;
                const overpaid = Number(row.overpaid_by || 0) > 0;

                let statusBadgeClass = "badge-unpaid";
                if (row.status === "Paid") statusBadgeClass = "badge-paid";
                else if (row.status === "Partial") statusBadgeClass = "badge-partial";

                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className={`borrow-row ${overdue ? "borrow-row--overdue" : ""} ${
                        expanded ? "borrow-row--expanded" : ""
                      }`}
                      onClick={() => setExpandedId(expanded ? null : row.id)}
                    >
                      <td className="expand-cell" title="Click to expand/collapse">
                        {expanded ? "▼" : "▶"}
                      </td>
                      <td className="cell-lender">
                        <strong>{row.lender_name}</strong>
                      </td>
                      <td>{row.lender_phone || "—"}</td>
                      <td className="cell-num">
                        {formatMoney(row.principal_amount, row.currency)}
                      </td>
                      <td>{row.borrowed_date}</td>
                      <td>
                        {row.due_date ? (
                          <span className={overdue ? "text-danger" : ""}>
                            {row.due_date}
                          </span>
                        ) : (
                          <span className="open-ended-tag">Open-ended</span>
                        )}
                      </td>
                      <td>
                        <span className="interest-info-pill">
                          {formatInterestInfo(row)}
                        </span>
                      </td>
                      <td>
                        <div className="status-badge-container">
                          <span className={`status-badge ${statusBadgeClass}`}>
                            {overpaid
                              ? `Paid (overpaid by ${formatMoney(row.overpaid_by, row.currency)})`
                              : row.status}
                          </span>
                          {overdue && (
                            <span className="overdue-warning-pill">
                              ⚠️ Overdue
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="cell-num text-good">
                        {formatMoney(row.total_paid, row.currency)}
                      </td>
                      <td className="cell-num text-bold">
                        {formatMoney(row.remaining_balance, row.currency)}
                      </td>
                      <td>{row.next_due_date || "—"}</td>
                      <td className="cell-num">
                        {row.remaining_balance > 0
                          ? formatMoney(row.next_installment_amount, row.currency)
                          : "—"}
                      </td>
                      <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="table-btn table-btn--pay"
                          title="Record a payment"
                          onClick={() => {
                            setPaymentBorrow(row);
                            setPaymentForm({
                              amount_paid: row.remaining_balance > 0 ? String(row.next_installment_amount || row.remaining_balance) : "",
                              payment_date: new Date().toISOString().slice(0, 10),
                              notes: "",
                            });
                          }}
                        >
                          + Pay
                        </button>
                        <button
                          type="button"
                          className="table-btn"
                          title="Edit this borrow"
                          onClick={() => handleEdit(row)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="table-btn table-btn--danger"
                          title="Delete this borrow"
                          onClick={() => handleDelete(row.id)}
                        >
                          Del
                        </button>
                      </td>
                    </tr>

                    {/* Expandable row content */}
                    {expanded && (
                      <tr className="borrow-detail-row">
                        <td colSpan={13}>
                          <div className="borrow-detail-panel">
                            {/* Lender Details */}
                            <div className="detail-section">
                              <h4>Lender Information</h4>
                              <div className="detail-kv">
                                <span className="detail-label">Name:</span>
                                <span className="detail-val">{row.lender?.name}</span>
                              </div>
                              <div className="detail-kv">
                                <span className="detail-label">Phone:</span>
                                <span className="detail-val">{row.lender?.phone}</span>
                              </div>
                              {row.lender?.email && (
                                <div className="detail-kv">
                                  <span className="detail-label">Email:</span>
                                  <span className="detail-val">{row.lender.email}</span>
                                </div>
                              )}
                              {row.lender?.notes && (
                                <div className="detail-kv">
                                  <span className="detail-label">Lender Notes:</span>
                                  <span className="detail-val">{row.lender.notes}</span>
                                </div>
                              )}
                            </div>

                            {/* Interest & Balance Breakdown */}
                            <div className="detail-section">
                              <h4>Interest & Financial Breakdown</h4>
                              <div className="detail-kv">
                                <span className="detail-label">Principal:</span>
                                <span className="detail-val">{formatMoney(row.principal_amount, row.currency)}</span>
                              </div>
                              <div className="detail-kv">
                                <span className="detail-label">Interest Formula:</span>
                                <span className="detail-val">{formatInterestInfo(row)}</span>
                              </div>
                              <div className="detail-kv">
                                <span className="detail-label">Accrued Interest:</span>
                                <span className="detail-val text-warn">
                                  {formatMoney(row.accrued_interest, row.currency)}
                                </span>
                              </div>
                              <div className="detail-kv">
                                <span className="detail-label">Total Payable to Date:</span>
                                <span className="detail-val text-bold">
                                  {formatMoney(row.total_payable_to_date, row.currency)}
                                </span>
                              </div>
                              <div className="detail-kv">
                                <span className="detail-label">Total Paid:</span>
                                <span className="detail-val text-good">
                                  {formatMoney(row.total_paid, row.currency)}
                                </span>
                              </div>
                              <div className="detail-kv">
                                <span className="detail-label">Remaining Balance:</span>
                                <span className="detail-val text-bold">
                                  {formatMoney(row.remaining_balance, row.currency)}
                                </span>
                              </div>
                              {overpaid && (
                                <div className="detail-kv">
                                  <span className="detail-label">Overpaid Amount:</span>
                                  <span className="detail-val text-good">
                                    {formatMoney(row.overpaid_by, row.currency)}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Payment History Mini Ledger */}
                            <div className="detail-section detail-section--wide">
                              <div className="ledger-header-row">
                                <h4>Payment History Ledger ({row.payments?.length || 0})</h4>
                                <button
                                  type="button"
                                  className="mini-pay-btn"
                                  onClick={() => {
                                    setPaymentBorrow(row);
                                    setPaymentForm(EMPTY_PAYMENT_FORM);
                                  }}
                                >
                                  + Record Payment
                                </button>
                              </div>

                              {(row.payments || []).length === 0 ? (
                                <p className="muted-text">No payments recorded for this loan yet.</p>
                              ) : (
                                <table className="payment-ledger">
                                  <thead>
                                    <tr>
                                      <th>Payment Date</th>
                                      <th>Amount Paid</th>
                                      <th>Notes / Method</th>
                                      <th style={{ width: "50px" }}>Action</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.payments.map((p) => (
                                      <tr key={p.id}>
                                        <td>{p.payment_date}</td>
                                        <td className="cell-num text-good">
                                          {formatMoney(p.amount_paid, row.currency)}
                                        </td>
                                        <td>{p.notes || "—"}</td>
                                        <td>
                                          <button
                                            type="button"
                                            className="ledger-del-btn"
                                            title="Delete this payment"
                                            onClick={() => deletePayment(row.id, p.id)}
                                          >
                                            ✕
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </PortalLayout>
  );
}
