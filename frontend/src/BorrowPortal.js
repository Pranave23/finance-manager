import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

const ACCESS_TOKEN_KEY = "fm_access_token";

/* ---------------------------------------------------------------- helpers */

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
  const errors = responseData?.errors ?? (message ? null : responseData);

  const formatErrors = (value, parentKey = "") => {
    if (Array.isArray(value)) return value.flatMap((item) => formatErrors(item, parentKey)).filter(Boolean);
    if (value && typeof value === "object") {
      return Object.entries(value).flatMap(([key, nested]) =>
        formatErrors(nested, parentKey ? `${parentKey}.${key}` : key)
      );
    }
    if (value === null || value === undefined || value === "") return [];
    return [parentKey ? `${parentKey.replace(/_/g, " ")}: ${String(value)}` : String(value)];
  };

  const details = formatErrors(errors);
  const base = typeof message === "string" && message.trim() ? message : fallbackMessage;
  return details.length ? `${base} (${details.join(" | ")})` : base;
}

const money = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (iso) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";

const today = () => new Date().toISOString().slice(0, 10);

/* --------------------------------------------- interest model (mirrors backend) */

const PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 365 / 12, yearly: 365 };
const PERIOD_UNIT = { daily: "day", weekly: "week", monthly: "month", yearly: "year" };
const SCHEDULE_LABEL = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
  one_time: "One-time (on due date)",
};
const TYPE_LABEL = { simple: "Simple", compound: "Compound", manual: "Manual" };

const plural = (n, unit) => `${Number(n.toFixed(1))} ${unit}${Math.abs(n - 1) < 0.05 ? "" : "s"}`;

function addSchedulePeriodsISO(startIso, sched, count) {
  if (!startIso || count <= 0) return startIso;
  const [y, m, d] = startIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (sched === "daily") {
    dt.setUTCDate(dt.getUTCDate() + count);
  } else if (sched === "weekly") {
    dt.setUTCDate(dt.getUTCDate() + 7 * count);
  } else if (sched === "yearly") {
    const targetYear = y + count;
    const maxDay = new Date(Date.UTC(targetYear, m, 0)).getUTCDate();
    return new Date(Date.UTC(targetYear, m - 1, Math.min(d, maxDay))).toISOString().slice(0, 10);
  } else {
    const totalMonths = (m - 1) + count;
    const targetYear = y + Math.floor(totalMonths / 12);
    const targetMonth = (totalMonths % 12) + 1;
    const maxDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    return new Date(Date.UTC(targetYear, targetMonth - 1, Math.min(d, maxDay))).toISOString().slice(0, 10);
  }
  return dt.toISOString().slice(0, 10);
}

function interestAtDate(row, targetIso) {
  const P = Number(row.principal_amount) || 0;
  if (!targetIso || !row.borrowed_date) return 0;
  const days = Math.max((Date.parse(targetIso) - Date.parse(row.borrowed_date)) / 86400000, 0);
  const periodDays = PERIOD_DAYS[row.rate_period] || PERIOD_DAYS.monthly;
  const t = days / periodDays;

  if (row.interest_type === "manual") {
    const manualAmt = Number(row.manual_interest_amount) || 0;
    if (!row.rate_period || row.rate_period === "overall") return manualAmt;
    return manualAmt * t;
  }
  const r = (Number(row.interest_rate) || 0) / 100;
  if (r <= 0) return 0;
  if (row.interest_type === "compound") {
    return P * ((1 + r) ** t - 1);
  }
  return P * r * t;
}

/**
 * Live preview for the "Record payment" modal:
 * computes early/late warning, interest at the chosen payment_date,
 * what the NEXT promised payment and remaining balance will be after this payment,
 * and the updated total repayment calculation.
 */
function computePaymentPreview(row, paymentForm) {
  if (!row) return null;
  const P = Number(row.principal_amount) || 0;
  const alreadyPaid = Number(row.total_paid) || 0;
  const payAmt = Number(paymentForm.amount_paid) || 0;
  const payDate = paymentForm.payment_date || today();
  const newTotalPaid = alreadyPaid + payAmt;

  const interestOnPayDate = interestAtDate(row, payDate);
  const totalPayableOnPayDate = P + interestOnPayDate;

  const estAtDue = row.estimated_total_at_due != null ? Number(row.estimated_total_at_due) : totalPayableOnPayDate;
  const isPastFinalDue = Boolean(row.due_date && payDate > row.due_date);

  // Target total for regular installments (uses due-date total unless we're already past due date)
  const targetTotal = isPastFinalDue ? Math.max(estAtDue, totalPayableOnPayDate) : estAtDue;
  const settlesToday = newTotalPaid >= totalPayableOnPayDate - 0.005;

  // Next promised installment calculation AFTER this payment
  const sched = row.repayment_schedule_type || "monthly";
  const nTotal = Number(row.total_scheduled_installments) || 1;
  let nextDateAfter = null;
  let nextAmountAfter = 0;
  let remainingAfter = 0;
  let finalProjectedTotal = targetTotal;

  if (settlesToday) {
    remainingAfter = 0;
    nextDateAfter = null;
    nextAmountAfter = 0;
    finalProjectedTotal = Math.min(newTotalPaid, totalPayableOnPayDate);
  } else {
    remainingAfter = Math.max((row.due_date ? targetTotal : totalPayableOnPayDate) - newTotalPaid, 0);
    if (sched === "one_time" || !row.due_date) {
      nextDateAfter = row.due_date || addSchedulePeriodsISO(row.borrowed_date, sched === "one_time" ? "monthly" : sched, (row.payments?.length || 0) + 2);
      nextAmountAfter = remainingAfter;
    } else {
      const regularInst = targetTotal / nTotal;
      const completedAfter = regularInst > 0 ? Math.min(Math.floor((newTotalPaid + 0.005) / regularInst), nTotal - 1) : 0;
      const nextK = completedAfter + 1;
      const candDate = addSchedulePeriodsISO(row.borrowed_date, sched, nextK);
      nextDateAfter = row.due_date && candDate > row.due_date ? row.due_date : candDate;

      const cumulativeTarget = Math.min(regularInst * nextK, targetTotal);
      const neededForMilestone = Math.max(cumulativeTarget - newTotalPaid, 0);
      nextAmountAfter = Math.min(neededForMilestone > 0.01 ? neededForMilestone : regularInst, remainingAfter);
    }
  }

  // Early / On-time / Late status relative to promised next_payment_date & final due_date
  const promisedDate = row.next_payment_date || row.due_date;
  let timingType = "on_time"; // "early" | "on_time" | "late"
  let timingDays = 0;
  if (promisedDate) {
    timingDays = Math.round((Date.parse(payDate) - Date.parse(promisedDate)) / 86400000);
    if (timingDays > 0) timingType = "late";
    else if (timingDays < -2) timingType = "early";
  }

  const earlyFullPayoffSavings = Math.max(estAtDue - totalPayableOnPayDate, 0);
  const lateExtraInterest = Math.max(totalPayableOnPayDate - estAtDue, 0);

  return {
    payAmt,
    payDate,
    alreadyPaid,
    newTotalPaid,
    interestOnPayDate,
    totalPayableOnPayDate,
    estAtDue,
    settlesToday,
    remainingAfter,
    nextDateAfter,
    nextAmountAfter,
    finalProjectedTotal,
    timingType,
    timingDays,
    promisedDate,
    earlyFullPayoffSavings,
    lateExtraInterest,
    isPastFinalDue,
  };
}

/**
 * Live estimate for the New/Edit Borrow form.
 */
function estimateLoan(f) {
  const P = Number(f.principal_amount) || 0;
  const r = (Number(f.interest_rate) || 0) / 100;
  const manualAmt = Number(f.manual_interest_amount) || 0;
  const isManualOverall = f.interest_type === "manual" && f.rate_period === "overall";
  const periodDays = PERIOD_DAYS[f.rate_period] || PERIOD_DAYS.monthly;
  const hasDue = !f.is_open_ended && f.due_date && f.borrowed_date;
  const days = hasDue ? Math.max((Date.parse(f.due_date) - Date.parse(f.borrowed_date)) / 86400000, 0) : null;
  const t = isManualOverall || days === null ? null : days / periodDays;
  const perYear = 365 / periodDays;

  let interest = null;
  if (f.interest_type === "manual") {
    interest = isManualOverall ? manualAmt : t !== null ? manualAmt * t : null;
  } else if (t !== null) {
    interest = f.interest_type === "compound" ? P * ((1 + r) ** t - 1) : P * r * t;
  }

  const total = interest === null ? null : P + interest;
  const annualRate =
    f.interest_type === "simple" ? r * perYear * 100 : f.interest_type === "compound" ? ((1 + r) ** perYear - 1) * 100 : null;

  const sched = f.repayment_schedule_type || "monthly";
  const schedDays = PERIOD_DAYS[sched] || PERIOD_DAYS.monthly;
  const installments =
    sched !== "one_time" && days !== null && days > 0 ? Math.max(1, Math.ceil(days / schedDays - 1e-9)) : null;

  return {
    P,
    t,
    days,
    interest,
    total,
    perPeriod: f.interest_type === "manual" ? (isManualOverall ? null : manualAmt) : P * r,
    annualRate,
    installments,
    installmentAmount: installments && total !== null ? total / installments : null,
    isManualOverall,
  };
}

function interestSummary(row) {
  if (row.interest_type === "manual") {
    if (!row.rate_period || row.rate_period === "overall") {
      return `Manual · ${money(row.manual_interest_amount)} overall`;
    }
    return `Manual · ${money(row.manual_interest_amount)} / ${PERIOD_UNIT[row.rate_period] || "month"}`;
  }
  return `${TYPE_LABEL[row.interest_type] || "Simple"} · ${Number(row.interest_rate)}% / ${PERIOD_UNIT[row.rate_period] || "month"}`;
}

const INTEREST_OPTIONS = [
  {
    value: "simple",
    title: "Simple interest",
    tagline: "Fixed % on the amount borrowed",
  },
  {
    value: "compound",
    title: "Compound interest",
    tagline: "Interest is charged on interest too",
  },
  {
    value: "manual",
    title: "Manual / fixed amount",
    tagline: "Fixed ₹ amount per period or overall",
  },
];

function InterestExplainer({ form, est }) {
  const unit = PERIOD_UNIT[form.rate_period] || "month";
  const rate = Number(form.interest_rate) || 0;
  const manualAmt = Number(form.manual_interest_amount) || 0;
  const P = est.P || 10000;
  const sample = !est.P;

  if (form.interest_type === "simple") {
    return (
      <p>
        You pay interest only on the original {money(P)}{sample ? " (example)" : ""}. At {rate || "R"}% per {unit},
        that is <strong>{money(P * (rate / 100))}</strong> every {unit}. The amount stays the same for the whole
        loan and never grows on unpaid interest. <em>Formula: Principal × Rate × Time.</em>
      </p>
    );
  }
  if (form.interest_type === "compound") {
    return (
      <p>
        At the end of every {unit}, unpaid interest is added to what you owe, and the next {unit}'s interest is
        charged on that bigger balance. The first {unit} costs {money(P * (rate / 100))}, and each {unit} after
        costs a little more. Over long periods this is noticeably more expensive than simple interest.{" "}
        <em>Formula: Principal × ((1 + Rate)^Time − 1).</em>
      </p>
    );
  }
  if (form.rate_period === "overall") {
    return (
      <p>
        You and the lender agree on one single flat interest amount ({manualAmt ? <strong>{money(manualAmt)}</strong> : "e.g. ₹2,000"}) for the entire loan, the way local lenders and small finance firms often work. The total interest does not multiply by days, weeks, or months.
      </p>
    );
  }
  return (
    <p>
      You and the lender agree on a fixed rupee amount ({manualAmt ? <strong>{money(manualAmt)}</strong> : "e.g. ₹500"}) charged every <strong>{unit}</strong>, common in informal and small-scale finance firms. Over the loan term, total interest equals{" "}
      <em>Fixed Amount × Number of {unit}s</em>.
    </p>
  );
}

/* ------------------------------------------------------------- form state */

const EMPTY_BORROW_FORM = {
  lender_mode: "existing",
  lender_id: "",
  new_lender_name: "",
  new_lender_phone: "",
  new_lender_email: "",
  new_lender_notes: "",
  principal_amount: "",
  borrowed_date: today(),
  is_open_ended: false,
  due_date: "",
  interest_type: "simple",
  interest_rate: "",
  rate_period: "monthly",
  manual_interest_amount: "",
  repayment_schedule_type: "monthly",
  notes: "",
};

const EMPTY_PAYMENT_FORM = { amount_paid: "", payment_date: today(), notes: "" };

function validateBorrowForm(f) {
  if (f.lender_mode === "existing" && !f.lender_id) return "Choose a lender.";
  if (!(Number(f.principal_amount) > 0)) return "Principal amount must be greater than 0.";
  if (!f.borrowed_date) return "Enter the borrowed date.";
  if (!f.is_open_ended) {
    if (!f.due_date) return "Enter a due date, or mark the loan as open-ended.";
    if (f.due_date < f.borrowed_date) return "Due date cannot be before the borrowed date.";
  }
  if (f.interest_type === "manual") {
    if (f.manual_interest_amount === "" || Number(f.manual_interest_amount) < 0)
      return "Enter the agreed interest amount (0 if interest-free).";
  } else if (f.interest_rate === "" || Number(f.interest_rate) < 0) {
    return "Enter the interest rate (0 if interest-free).";
  }
  return "";
}

/* -------------------------------------------------------------- component */

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
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const authHeaders = useMemo(
    () => ({ Authorization: `Bearer ${localStorage.getItem(ACCESS_TOKEN_KEY)}` }),
    []
  );

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const est = useMemo(() => estimateLoan(form), [form]);
  const paymentPreview = useMemo(
    () => computePaymentPreview(paymentBorrow, paymentForm),
    [paymentBorrow, paymentForm]
  );

  const filteredBorrows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return borrows.filter((r) => {
      if (statusFilter === "active" && r.status === "Paid") return false;
      if (statusFilter === "overdue" && !r.is_overdue && r.schedule_status !== "late") return false;
      if (statusFilter === "paid" && r.status !== "Paid") return false;
      if (!q) return true;
      const hay = [r.lender?.name, r.lender?.phone, r.lender?.email, r.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [borrows, searchQuery, statusFilter]);

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

  const closeForm = () => {
    setForm(EMPTY_BORROW_FORM);
    setEditingId(null);
    setShowForm(false);
  };

  const openNewForm = () => {
    setForm({ ...EMPTY_BORROW_FORM, borrowed_date: today() });
    setEditingId(null);
    setPaymentBorrow(null);
    setShowForm(true);
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setPaymentBorrow(null);
    setShowForm(true);
    setForm({
      ...EMPTY_BORROW_FORM,
      lender_mode: "existing",
      lender_id: row.lender?.id || "",
      principal_amount: row.principal_amount,
      borrowed_date: row.borrowed_date,
      is_open_ended: !row.due_date,
      due_date: row.due_date || "",
      interest_type: row.interest_type || "simple",
      interest_rate: row.interest_type === "manual" ? "" : String(Number(row.interest_rate)),
      rate_period: row.rate_period || "monthly",
      manual_interest_amount: row.interest_type === "manual" ? String(Number(row.manual_interest_amount)) : "",
      repayment_schedule_type: row.repayment_schedule_type || "monthly",
      notes: row.notes || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const buildBorrowPayload = async () => {
    let lenderId = form.lender_id;
    if (form.lender_mode === "new" && !editingId) {
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
      lenderId = parseObjectPayload(lenderRes.data).id;
    }
    const manual = form.interest_type === "manual";
    return {
      lender_id: lenderId,
      principal_amount: Number(form.principal_amount),
      borrowed_date: form.borrowed_date,
      due_date: form.is_open_ended ? null : form.due_date,
      interest_type: form.interest_type,
      interest_rate: manual ? 0 : Number(form.interest_rate),
      rate_period: form.rate_period,
      manual_interest_amount: manual ? Number(form.manual_interest_amount) : 0,
      repayment_schedule_type: form.repayment_schedule_type || "monthly",
      notes: form.notes || "",
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const problem = validateBorrowForm(form);
    if (problem) {
      setErrorMessage(problem);
      return;
    }
    setErrorMessage("");
    setSaving(true);
    try {
      const payload = await buildBorrowPayload();
      if (editingId) await api.put(`/borrow/${editingId}/`, payload, { headers: authHeaders });
      else await api.post("/borrow/", payload, { headers: authHeaders });
      closeForm();
      await fetchAll();
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to save borrow."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete the ${money(row.principal_amount)} loan from ${row.lender?.name}? This cannot be undone.`))
      return;
    try {
      await api.delete(`/borrow/${row.id}/`, { headers: authHeaders });
      await fetchAll();
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to delete borrow."));
    }
  };

  const openPayment = (row) => {
    setShowForm(false);
    setPaymentBorrow(row);
    const defaultAmt =
      row.next_payment_amount != null && Number(row.next_payment_amount) > 0
        ? String(Number(row.next_payment_amount))
        : row.remaining_balance != null && Number(row.remaining_balance) > 0
        ? String(Number(row.remaining_balance))
        : "";
    setPaymentForm({ ...EMPTY_PAYMENT_FORM, amount_paid: defaultAmt, payment_date: today() });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submitPayment = async (e) => {
    e.preventDefault();
    if (!paymentBorrow) return;
    if (!(Number(paymentForm.amount_paid) > 0)) {
      setErrorMessage("Payment amount must be greater than 0.");
      return;
    }
    if (paymentForm.payment_date < paymentBorrow.borrowed_date) {
      setErrorMessage("Payment date cannot be before the borrowed date.");
      return;
    }
    setErrorMessage("");
    setSaving(true);
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
    } finally {
      setSaving(false);
    }
  };

  const deletePayment = async (borrowId, paymentId) => {
    if (!window.confirm("Delete this payment entry?")) return;
    try {
      await api.delete(`/borrow/${borrowId}/payments/${paymentId}/`, { headers: authHeaders });
      await fetchAll();
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to delete payment."));
    }
  };

  const unit = PERIOD_UNIT[form.rate_period] || "month";

  return (
    <PortalLayout userMobile={userMobile} activeTab="borrow" onLogout={onLogout}>
      {/* Summary */}
      <div className="borrow-summary-grid">
        <div className="summary-card">
          <span className="summary-card__label">Total Borrowed</span>
          <span className="summary-card__value">{money(summary?.total_borrowed)}</span>
          <span className="summary-card__sub">Principal across all loans</span>
        </div>
        <div className="summary-card">
          <span className="summary-card__label">Total Outstanding</span>
          <span className="summary-card__value summary-card__value--warn">{money(summary?.total_outstanding)}</span>
          <span className="summary-card__sub">Principal + interest still owed today</span>
        </div>
        <div className="summary-card">
          <span className="summary-card__label">Total Paid</span>
          <span className="summary-card__value summary-card__value--good">{money(summary?.total_paid)}</span>
          <span className="summary-card__sub">All repayments recorded</span>
        </div>
        <div className="summary-card">
          <span className="summary-card__label">Overdue Loans</span>
          <span className="summary-card__value summary-card__value--danger">{summary?.overdue_count ?? 0}</span>
          <span className="summary-card__sub">Past due date, not fully repaid</span>
        </div>
      </div>

      <div className="portal-banner">
        <div className="banner-info">
          <h2>Borrowings</h2>
          <p className="banner-subtitle">Money you owe, what it costs, and what's left to repay.</p>
        </div>
        {!showForm && (
          <button type="button" className="action-btn" onClick={openNewForm}>
            New borrowing
          </button>
        )}
      </div>

      {errorMessage && <div className="portal-error">{errorMessage}</div>}

      {/* ------------------------------------------------ Add / edit form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="record-form-card" noValidate>
          <div className="form-head">
            <h3>{editingId ? "Edit borrowing" : "New borrowing"}</h3>
            <button type="button" className="link-btn" onClick={closeForm}>
              Cancel
            </button>
          </div>

          {/* 1. Lender (unchanged) */}
          <section className="form-section">
            <h4 className="form-section__title">Lender</h4>
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
                        onChange={() => set({ lender_mode: "existing" })}
                      />
                      Select Existing Lender
                    </label>
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="lender_mode"
                        value="new"
                        checked={form.lender_mode === "new"}
                        onChange={() => set({ lender_mode: "new" })}
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
                    onChange={(e) => set({ lender_id: e.target.value })}
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
                      onChange={(e) => set({ new_lender_name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-field">
                    <label>Lender Phone *</label>
                    <input
                      className="form-input"
                      placeholder="e.g. 9876543210"
                      value={form.new_lender_phone}
                      onChange={(e) => set({ new_lender_phone: e.target.value })}
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
                      onChange={(e) => set({ new_lender_email: e.target.value })}
                    />
                  </div>
                  <div className="form-field">
                    <label>Lender Notes (optional)</label>
                    <input
                      className="form-input"
                      placeholder="Contact notes..."
                      value={form.new_lender_notes}
                      onChange={(e) => set({ new_lender_notes: e.target.value })}
                    />
                  </div>
                </>
              )}
            </div>
          </section>

          {/* 2. Amount & dates */}
          <section className="form-section">
            <h4 className="form-section__title">Amount &amp; dates</h4>
            <div className="form-grid">
              <div className="form-field">
                <label>Principal amount (₹)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className="form-input"
                  placeholder="10000"
                  value={form.principal_amount}
                  onChange={(e) => set({ principal_amount: e.target.value })}
                />
                <span className="field-hint">The amount you actually received.</span>
              </div>
              <div className="form-field">
                <label>Borrowed on</label>
                <input
                  type="date"
                  className="form-input"
                  value={form.borrowed_date}
                  max={form.is_open_ended || !form.due_date ? undefined : form.due_date}
                  onChange={(e) => set({ borrowed_date: e.target.value })}
                />
              </div>
              <div className="form-field">
                <label>Due date</label>
                <input
                  type="date"
                  className="form-input"
                  disabled={form.is_open_ended}
                  min={form.borrowed_date || undefined}
                  value={form.is_open_ended ? "" : form.due_date}
                  onChange={(e) => set({ due_date: e.target.value })}
                />
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.is_open_ended}
                    onChange={(e) => set({ is_open_ended: e.target.checked, due_date: "" })}
                  />
                  Open-ended (no fixed due date)
                </label>
              </div>
            </div>
          </section>

          {/* 3. Interest & Repayment Promise */}
          <section className="form-section">
            <h4 className="form-section__title">Interest &amp; repayment promise</h4>
            <div className="interest-options" role="radiogroup" aria-label="Interest type">
              {INTEREST_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={form.interest_type === opt.value}
                  className={`interest-option ${form.interest_type === opt.value ? "interest-option--active" : ""}`}
                  onClick={() =>
                    set({
                      interest_type: opt.value,
                      rate_period:
                        opt.value !== "manual" && form.rate_period === "overall" ? "monthly" : form.rate_period,
                    })
                  }
                >
                  <span className="interest-option__title">{opt.title}</span>
                  <span className="interest-option__desc">{opt.tagline}</span>
                </button>
              ))}
            </div>

            <div className="interest-explainer">
              <InterestExplainer form={form} est={est} />
            </div>

            <div className="form-grid">
              {form.interest_type === "manual" ? (
                <>
                  <div className="form-field">
                    <label>Agreed interest amount (₹)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      className="form-input"
                      placeholder="e.g. 500"
                      value={form.manual_interest_amount}
                      onChange={(e) => set({ manual_interest_amount: e.target.value })}
                    />
                    <span className="field-hint">
                      {form.rate_period === "overall"
                        ? "Total flat interest for the entire loan."
                        : `Fixed rupee interest charged every ${unit}.`}
                    </span>
                  </div>
                  <div className="form-field">
                    <label>Interest applies per</label>
                    <select
                      className="form-input"
                      value={form.rate_period}
                      onChange={(e) => set({ rate_period: e.target.value })}
                    >
                      <option value="daily">Day</option>
                      <option value="weekly">Week</option>
                      <option value="monthly">Month</option>
                      <option value="yearly">Year</option>
                      <option value="overall">Overall (One-time total)</option>
                    </select>
                    <span className="field-hint">
                      {form.rate_period === "overall"
                        ? "Single lump-sum interest regardless of duration."
                        : `Multiplies by the number of ${unit}s until the due date.`}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="form-field">
                    <label>Interest rate (%)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      className="form-input"
                      placeholder="e.g. 2"
                      value={form.interest_rate}
                      onChange={(e) => set({ interest_rate: e.target.value })}
                    />
                    {est.annualRate !== null && Number(form.interest_rate) > 0 && (
                      <span className="field-hint">
                        ≈ {est.annualRate.toFixed(2)}% per year
                        {form.interest_type === "compound" ? " (effective)" : ""}
                      </span>
                    )}
                  </div>
                  <div className="form-field">
                    <label>Rate applies per</label>
                    <select
                      className="form-input"
                      value={form.rate_period}
                      onChange={(e) => set({ rate_period: e.target.value })}
                    >
                      <option value="daily">Day</option>
                      <option value="weekly">Week</option>
                      <option value="monthly">Month</option>
                      <option value="yearly">Year</option>
                    </select>
                    <span className="field-hint">
                      {form.interest_type === "compound"
                        ? `Interest is added to the balance every ${unit}.`
                        : `e.g. "2% per month" — ask the lender which period they mean.`}
                    </span>
                  </div>
                </>
              )}

              <div className="form-field">
                <label>Promised repayment frequency</label>
                <select
                  className="form-input"
                  value={form.repayment_schedule_type}
                  onChange={(e) => set({ repayment_schedule_type: e.target.value })}
                >
                  <option value="monthly">Monthly payments</option>
                  <option value="weekly">Weekly payments</option>
                  <option value="daily">Daily payments</option>
                  <option value="yearly">Yearly payments</option>
                  <option value="one_time">One-time (full amount on due date)</option>
                </select>
                <span className="field-hint">
                  How often you promised to pay — calculates your next due date and installment amount.
                </span>
              </div>
            </div>
          </section>

          {/* 4. Estimate */}
          <section className="estimate-panel" aria-live="polite">
            <div className="estimate-row">
              <span>Principal</span>
              <span>{money(est.P)}</span>
            </div>
            <div className="estimate-row">
              <span>
                Interest
                {est.t !== null && !est.isManualOverall ? ` over ${plural(est.t, unit)}` : ""}
              </span>
              <span>{est.interest === null ? "—" : money(est.interest)}</span>
            </div>
            {est.installmentAmount !== null && (
              <div className="estimate-row">
                <span>
                  Promised {SCHEDULE_LABEL[form.repayment_schedule_type]?.toLowerCase() || "monthly"} installment (
                  {est.installments} payments)
                </span>
                <span>{money(est.installmentAmount)}</span>
              </div>
            )}
            <div className="estimate-row estimate-row--total">
              <span>Estimated total to repay{form.is_open_ended ? "" : " by due date"}</span>
              <span>{est.total === null ? "—" : money(est.total)}</span>
            </div>
            <p className="estimate-note">
              {form.is_open_ended
                ? est.isManualOverall
                  ? "Open-ended loan with an overall flat interest amount: the total above doesn't change with time."
                  : `Open-ended loan: there's no fixed total. Interest keeps adding up at about ${money(
                      est.perPeriod
                    )} per ${unit}${form.interest_type === "compound" ? " (and growing)" : ""} until you repay.`
                : est.total === null
                ? "Enter the principal and a due date to see the estimate."
                : `Assumes the full amount is repaid on ${fmtDate(form.due_date)} with no delays.${
                    est.isManualOverall
                      ? ""
                      : " Paying early saves interest; paying late adds interest for every extra day."
                  }`}
            </p>
          </section>

          <div className="form-field full-width">
            <label>Notes (optional)</label>
            <textarea
              className="form-input"
              rows={2}
              placeholder="Purpose, collateral, agreement terms…"
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>

          <div className="form-actions">
            <button type="submit" className="primary-btn" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Save borrowing"}
            </button>
            <button type="button" className="secondary-btn" onClick={closeForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ------------------------------------------------ Payment form */}
      {paymentBorrow && paymentPreview && (
        <form onSubmit={submitPayment} className="record-form-card payment-form-card" noValidate>
          <div className="form-head">
            <h3>Record payment · {paymentBorrow.lender?.name}</h3>
            <button type="button" className="link-btn" onClick={() => setPaymentBorrow(null)}>
              Cancel
            </button>
          </div>

          {/* Promised Next Payment & Schedule Banner */}
          <div className="promise-summary-bar">
            <div className="promise-summary-item">
              <span className="promise-summary-label">
                Promised Schedule ({SCHEDULE_LABEL[paymentBorrow.repayment_schedule_type || "monthly"]})
              </span>
              <span className="promise-summary-val">
                {paymentBorrow.next_payment_amount != null ? money(paymentBorrow.next_payment_amount) : "—"}
                {paymentBorrow.next_payment_date && ` due ${fmtDate(paymentBorrow.next_payment_date)}`}
              </span>
              {paymentBorrow.total_scheduled_installments > 1 && (
                <span className="promise-summary-sub">
                  Installment {(paymentBorrow.installments_completed || 0) + 1} of{" "}
                  {paymentBorrow.total_scheduled_installments}
                </span>
              )}
            </div>
            <div className="promise-summary-item">
              <span className="promise-summary-label">Payoff Today (Principal + Accrued Interest)</span>
              <span className="promise-summary-val">{money(paymentPreview.totalPayableOnPayDate - paymentPreview.alreadyPaid)}</span>
              <span className="promise-summary-sub">
                Interest accrued to {fmtDate(paymentPreview.payDate)}: {money(paymentPreview.interestOnPayDate)}
              </span>
            </div>
            {paymentBorrow.estimated_total_at_due != null && (
              <div className="promise-summary-item">
                <span className="promise-summary-label">Scheduled Total at Due Date</span>
                <span className="promise-summary-val">{money(paymentBorrow.estimated_total_at_due)}</span>
                <span className="promise-summary-sub">
                  Remaining from scheduled total:{" "}
                  {money(Math.max(Number(paymentBorrow.estimated_total_at_due) - paymentPreview.alreadyPaid, 0))}
                </span>
              </div>
            )}
          </div>

          {/* Early / On-Time / Late Warning Alert */}
          <div className={`schedule-alert schedule-alert--${paymentPreview.timingType}`}>
            {paymentPreview.timingType === "late" && (
              <>
                <span className="schedule-alert__badge">⚠️ Late Payment ({paymentPreview.timingDays}d past promised date)</span>
                <p>
                  This payment is <strong>{paymentPreview.timingDays} day(s)</strong> after the promised date (
                  {fmtDate(paymentPreview.promisedDate)}).
                  {paymentPreview.lateExtraInterest > 0
                    ? ` Extra interest of ${money(
                        paymentPreview.lateExtraInterest
                      )} has accrued beyond the original due-date estimate, bringing the total loan cost to ${money(
                        paymentPreview.totalPayableOnPayDate
                      )}.`
                    : ` Pay at least ${money(paymentBorrow.next_payment_amount)} to catch up on your promised schedule.`}
                </p>
              </>
            )}
            {paymentPreview.timingType === "early" && (
              <>
                <span className="schedule-alert__badge">⚡ Early Payment ({Math.abs(paymentPreview.timingDays)}d ahead of schedule)</span>
                <p>
                  You are paying <strong>{Math.abs(paymentPreview.timingDays)} day(s) early</strong> (promised on{" "}
                  {fmtDate(paymentPreview.promisedDate)}).
                  {paymentPreview.earlyFullPayoffSavings > 0
                    ? ` If you settle the full balance today (${money(
                        paymentPreview.totalPayableOnPayDate - paymentPreview.alreadyPaid
                      )}), your total loan cost drops to ${money(
                        paymentPreview.totalPayableOnPayDate
                      )} — saving ${money(paymentPreview.earlyFullPayoffSavings)} in future interest!`
                    : ` Paying early reduces your remaining balance ahead of schedule.`}
                </p>
              </>
            )}
            {paymentPreview.timingType === "on_time" && (
              <>
                <span className="schedule-alert__badge">✓ On Track with Promised Schedule</span>
                <p>
                  Promised installment due on <strong>{fmtDate(paymentPreview.promisedDate)}</strong>:{" "}
                  <strong>{money(paymentBorrow.next_payment_amount)}</strong>.
                  {paymentPreview.earlyFullPayoffSavings > 0 &&
                    ` Settling the entire loan today (${money(
                      paymentPreview.totalPayableOnPayDate - paymentPreview.alreadyPaid
                    )}) would save ${money(paymentPreview.earlyFullPayoffSavings)} in future interest.`}
                </p>
              </>
            )}
          </div>

          <div className="form-grid">
            <div className="form-field">
              <label>Amount (₹)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="form-input"
                value={paymentForm.amount_paid}
                onChange={(e) => setPaymentForm({ ...paymentForm, amount_paid: e.target.value })}
              />
              <div className="quick-pay-chips">
                {paymentBorrow.next_payment_amount != null && Number(paymentBorrow.next_payment_amount) > 0 && (
                  <button
                    type="button"
                    className="link-btn link-btn--inline"
                    onClick={() =>
                      setPaymentForm({
                        ...paymentForm,
                        amount_paid: String(Number(paymentBorrow.next_payment_amount)),
                      })
                    }
                  >
                    Pay promised ({money(paymentBorrow.next_payment_amount)})
                  </button>
                )}
                {paymentPreview.totalPayableOnPayDate - paymentPreview.alreadyPaid > 0 && (
                  <button
                    type="button"
                    className="link-btn link-btn--inline"
                    onClick={() =>
                      setPaymentForm({
                        ...paymentForm,
                        amount_paid: String(
                          Number((paymentPreview.totalPayableOnPayDate - paymentPreview.alreadyPaid).toFixed(2))
                        ),
                      })
                    }
                  >
                    Settle full today ({money(paymentPreview.totalPayableOnPayDate - paymentPreview.alreadyPaid)})
                  </button>
                )}
              </div>
            </div>
            <div className="form-field">
              <label>Payment date</label>
              <input
                type="date"
                className="form-input"
                min={paymentBorrow.borrowed_date}
                value={paymentForm.payment_date}
                onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })}
              />
            </div>
            <div className="form-field full-width">
              <label>Reference (optional)</label>
              <input
                className="form-input"
                placeholder="UPI ref, bank transfer, cash…"
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
              />
            </div>
          </div>

          {/* Live Next-Calculation & Remaining Preview after this payment */}
          {paymentPreview.payAmt > 0 && (
            <section className="estimate-panel payment-impact-panel" aria-live="polite">
              <h4 className="form-section__title" style={{ marginBottom: "8px" }}>
                Calculation after this {money(paymentPreview.payAmt)} payment
              </h4>
              <div className="estimate-row">
                <span>Total paid (including this payment)</span>
                <span className="text-good">{money(paymentPreview.newTotalPaid)}</span>
              </div>
              <div className="estimate-row">
                <span>Remaining balance after this payment</span>
                <span className="text-bold">{money(paymentPreview.remainingAfter)}</span>
              </div>
              <div className="estimate-row">
                <span>Next payment promised after this</span>
                <span>
                  {paymentPreview.settlesToday
                    ? "None — Loan will be fully settled! 🎉"
                    : `${money(paymentPreview.nextAmountAfter)}${
                        paymentPreview.nextDateAfter ? ` on ${fmtDate(paymentPreview.nextDateAfter)}` : ""
                      }`}
                </span>
              </div>
              <div className="estimate-row estimate-row--total">
                <span>
                  {paymentPreview.settlesToday
                    ? "Final total paid for this loan"
                    : paymentPreview.isPastFinalDue
                    ? "Updated total loan payable (with late interest)"
                    : "Projected total repayment (if paid on schedule)"}
                </span>
                <span>{money(paymentPreview.finalProjectedTotal)}</span>
              </div>
            </section>
          )}

          <div className="form-actions">
            <button type="submit" className="primary-btn" disabled={saving}>
              {saving ? "Saving…" : "Record payment"}
            </button>
          </div>
        </form>
      )}

      {/* ------------------------------------------------ Table */}
      <div className="borrow-table-wrap">
        {!loading && borrows.length > 0 && (
          <div className="ledger-toolbar">
            <div className="ledger-search-wrap">
              <span className="ledger-search-icon" aria-hidden="true">⌕</span>
              <input
                type="search"
                className="ledger-search-input"
                placeholder="Search lender name, mobile, or notes…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="ledger-filter-pills" role="tablist" aria-label="Filter loans">
              {[
                { key: "all", label: `All (${borrows.length})` },
                { key: "active", label: `Active (${borrows.filter((b) => b.status !== "Paid").length})` },
                {
                  key: "overdue",
                  label: `Attention (${borrows.filter((b) => b.is_overdue || b.schedule_status === "late").length})`,
                },
                { key: "paid", label: `Settled (${borrows.filter((b) => b.status === "Paid").length})` },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`filter-pill ${statusFilter === tab.key ? "filter-pill--active" : ""}`}
                  onClick={() => setStatusFilter(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && <div className="loading-spinner">Loading…</div>}
        {!loading && borrows.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">◈</span>
            <h3>No borrowings yet</h3>
            <p>Add your first one with "New borrowing".</p>
          </div>
        )}
        {!loading && borrows.length > 0 && filteredBorrows.length === 0 && (
          <div className="empty-state">
            <h3>No matching loans</h3>
            <p>Try clearing your search or switching the status filter.</p>
          </div>
        )}

        {!loading && filteredBorrows.length > 0 && (
          <table className="borrow-table">
            <thead>
              <tr>
                <th aria-label="Expand" style={{ width: "32px" }} />
                <th>Lender</th>
                <th className="cell-num">Principal</th>
                <th>Borrowed</th>
                <th>Due</th>
                <th>Interest</th>
                <th>Next Promised</th>
                <th className="cell-num">Total at due</th>
                <th className="cell-num">Paid</th>
                <th className="cell-num">Outstanding</th>
                <th>Status</th>
                <th className="cell-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredBorrows.map((row) => {
                const expanded = expandedId === row.id;
                const paid = row.status === "Paid";
                const badge = paid ? "badge-paid" : row.status === "Partial" ? "badge-partial" : "badge-unpaid";
                const denom = Number(row.total_payable_to_date || row.principal_amount || 1);
                const paidPct = Math.min(100, Math.round((Number(row.total_paid || 0) / Math.max(denom, 1)) * 100));

                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className={`borrow-row ${row.is_overdue ? "borrow-row--overdue" : ""} ${
                        expanded ? "borrow-row--expanded" : ""
                      }`}
                      onClick={() => setExpandedId(expanded ? null : row.id)}
                    >
                      <td className="expand-cell">{expanded ? "▾" : "▸"}</td>
                      <td>
                        <div className="cell-lender">{row.lender?.name || "—"}</div>
                        <div className="cell-sub">{row.lender?.phone}</div>
                      </td>
                      <td className="cell-num">{money(row.principal_amount)}</td>
                      <td>{fmtDate(row.borrowed_date)}</td>
                      <td>
                        {row.due_date ? (
                          <span className={row.is_overdue ? "text-danger" : ""}>{fmtDate(row.due_date)}</span>
                        ) : (
                          <span className="open-ended-tag">Open-ended</span>
                        )}
                      </td>
                      <td className="cell-sub-strong">{interestSummary(row)}</td>
                      <td>
                        {paid ? (
                          <span className="cell-sub">Settled</span>
                        ) : (
                          <div>
                            <div className="cell-num" style={{ textAlign: "left", fontWeight: 600 }}>
                              {row.next_payment_amount != null ? money(row.next_payment_amount) : "—"}
                            </div>
                            <div className="cell-sub">
                              {row.next_payment_date ? fmtDate(row.next_payment_date) : "—"} ·{" "}
                              {SCHEDULE_LABEL[row.repayment_schedule_type || "monthly"]?.split(" ")[0]}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="cell-num">
                        {row.estimated_total_at_due != null ? money(row.estimated_total_at_due) : "—"}
                      </td>
                      <td className="cell-num">
                        <div>{money(row.total_paid)}</div>
                        <div className="progress-track" title={`${paidPct}% repaid`}>
                          <div className="progress-fill" style={{ width: `${paid ? 100 : paidPct}%` }} />
                        </div>
                      </td>
                      <td className="cell-num text-bold">{money(row.remaining_balance)}</td>
                      <td>
                        <div className="status-badge-container">
                          <span className={`status-badge ${badge}`}>{row.status}</span>
                          {row.is_overdue && (
                            <span className="overdue-warning-pill">⚠️ Overdue {row.days_overdue}d</span>
                          )}
                          {!row.is_overdue && row.schedule_status === "late" && (
                            <span className="overdue-warning-pill">
                              ⚠️ Installment late {row.schedule_days_diff}d
                            </span>
                          )}
                          {!row.is_overdue && row.schedule_status === "due_soon" && (
                            <span className="schedule-pill schedule-pill--soon">⏰ Due soon</span>
                          )}
                          {row.schedule_status === "early" && (
                            <span className="schedule-pill schedule-pill--early">⚡ Ahead of schedule</span>
                          )}
                          {row.schedule_status === "settled_early" && (
                            <span className="schedule-pill schedule-pill--early">
                              ⚡ Paid early (saved {money(row.early_savings)})
                            </span>
                          )}
                          {row.schedule_status === "settled_late" && (
                            <span className="overdue-warning-pill">
                              ⚠️ Paid late (+{money(row.late_extra_interest)})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="cell-actions" onClick={(e) => e.stopPropagation()}>
                        <div className="btn-group">
                          <button
                            type="button"
                            className="btn-sm btn-sm--primary"
                            disabled={paid}
                            onClick={() => openPayment(row)}
                          >
                            Pay
                          </button>
                          <button type="button" className="btn-sm" onClick={() => handleEdit(row)}>
                            Edit
                          </button>
                          <button type="button" className="btn-sm btn-sm--danger" onClick={() => handleDelete(row)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>

                    {expanded && (
                      <tr className="borrow-detail-row">
                        <td colSpan={12}>
                          <div className="borrow-detail-panel">
                            <div className="detail-section">
                              <h4>Lender</h4>
                              <KV label="Name" value={row.lender?.name} />
                              <KV label="Phone" value={row.lender?.phone} />
                              {row.lender?.email && <KV label="Email" value={row.lender.email} />}
                              {row.lender?.notes && <KV label="Notes" value={row.lender.notes} />}
                              {row.notes && <KV label="Loan notes" value={row.notes} />}
                            </div>

                            <div className="detail-section">
                              <h4>Calculation &amp; Schedule</h4>
                              <KV label="Principal" value={money(row.principal_amount)} />
                              <KV label="Interest" value={interestSummary(row)} />
                              <KV
                                label="Promised frequency"
                                value={SCHEDULE_LABEL[row.repayment_schedule_type || "monthly"]}
                              />
                              {row.due_date && (
                                <>
                                  <KV
                                    label="Term"
                                    value={
                                      row.interest_type === "manual" && (!row.rate_period || row.rate_period === "overall")
                                        ? `${fmtDate(row.borrowed_date)} → ${fmtDate(row.due_date)}`
                                        : plural(Number(row.tenure_periods), PERIOD_UNIT[row.rate_period] || "month")
                                    }
                                  />
                                  <KV label="Interest if paid on due date" value={money(row.estimated_interest_at_due)} />
                                  <KV label="Total if paid on due date" value={money(row.estimated_total_at_due)} strong />
                                </>
                              )}
                              <hr className="detail-divider" />
                              <KV
                                label={row.settled_on ? `Interest (settled ${fmtDate(row.settled_on)})` : "Interest so far"}
                                value={money(row.accrued_interest)}
                              />
                              <KV label="Owed so far (if settled today)" value={money(row.total_payable_to_date)} />
                              <KV label="Paid so far" value={money(row.total_paid)} />
                              <KV label="Outstanding today" value={money(row.remaining_balance)} strong />
                              {!paid && row.next_payment_amount != null && (
                                <KV
                                  label="Next promised payment"
                                  value={`${money(row.next_payment_amount)}${
                                    row.next_payment_date ? ` on ${fmtDate(row.next_payment_date)}` : ""
                                  }`}
                                  strong
                                />
                              )}
                              {!paid && Number(row.early_savings) > 0 && (
                                <KV
                                  label="Early payoff savings (if settled today)"
                                  value={`${money(row.early_savings)} saved`}
                                />
                              )}
                              {Number(row.late_extra_interest) > 0 && (
                                <KV
                                  label="Extra late interest accrued"
                                  value={`+${money(row.late_extra_interest)}`}
                                />
                              )}
                              {Number(row.overpaid_by) > 0 && <KV label="Overpaid by" value={money(row.overpaid_by)} />}
                            </div>

                            <div className="detail-section detail-section--wide">
                              <div className="ledger-header-row">
                                <h4>Payments ({row.payments?.length || 0})</h4>
                              </div>
                              {(row.payments || []).length === 0 ? (
                                <p className="muted-text">No payments recorded yet.</p>
                              ) : (
                                <table className="payment-ledger">
                                  <thead>
                                    <tr>
                                      <th>Date</th>
                                      <th className="cell-num">Amount</th>
                                      <th>Reference</th>
                                      <th aria-label="Delete" />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.payments.map((p) => (
                                      <tr key={p.id}>
                                        <td>{fmtDate(p.payment_date)}</td>
                                        <td className="cell-num">{money(p.amount_paid)}</td>
                                        <td>{p.notes || "—"}</td>
                                        <td>
                                          <button
                                            type="button"
                                            className="ledger-del-btn"
                                            title="Delete payment"
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

function KV({ label, value, strong }) {
  return (
    <div className="detail-kv">
      <span className="detail-label">{label}</span>
      <span className={`detail-val ${strong ? "text-bold" : ""}`}>{value ?? "—"}</span>
    </div>
  );
}
