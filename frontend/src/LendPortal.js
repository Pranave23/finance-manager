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

const formatAadhar = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 12);
  if (!digits) return "—";
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
};

const today = () => new Date().toISOString().slice(0, 10);

/* --------------------------------------------- interest & LTV model */

const PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 365 / 12, yearly: 365 };
const PERIOD_UNIT = { daily: "day", weekly: "week", monthly: "month", yearly: "year" };
const SCHEDULE_LABEL = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
  one_time: "One-time (on due date)",
};
const COLLATERAL_LABELS = {
  none: "Unsecured (No Collateral)",
  gold: "Gold / Jewellery",
  vehicle: "Vehicle (2W / 4W + RC)",
  property: "Property / Land Title Deed",
  electronics: "Electronics / Machinery",
  cheque: "Post-Dated Cheque / Promissory Note",
  other: "Other Asset",
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
  if (!targetIso || !row.lent_date) return 0;
  const days = Math.max((Date.parse(targetIso) - Date.parse(row.lent_date)) / 86400000, 0);
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

function computeCollectionPreview(row, paymentForm) {
  if (!row) return null;
  const P = Number(row.principal_amount) || 0;
  const alreadyCollected = Number(row.total_paid) || 0;
  const payAmt = Number(paymentForm.amount_paid) || 0;
  const payDate = paymentForm.payment_date || today();
  const newTotalCollected = alreadyCollected + payAmt;

  const interestOnPayDate = interestAtDate(row, payDate);
  const totalReceivableOnPayDate = P + interestOnPayDate;

  const estAtDue = row.estimated_total_at_due != null ? Number(row.estimated_total_at_due) : totalReceivableOnPayDate;
  const isPastFinalDue = Boolean(row.due_date && payDate > row.due_date);

  const targetTotal = isPastFinalDue ? Math.max(estAtDue, totalReceivableOnPayDate) : estAtDue;
  const settlesToday = newTotalCollected >= totalReceivableOnPayDate - 0.005;

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
    finalProjectedTotal = Math.min(newTotalCollected, totalReceivableOnPayDate);
  } else {
    remainingAfter = Math.max((row.due_date ? targetTotal : totalReceivableOnPayDate) - newTotalCollected, 0);
    if (sched === "one_time" || !row.due_date) {
      nextDateAfter =
        row.due_date ||
        addSchedulePeriodsISO(row.lent_date, sched === "one_time" ? "monthly" : sched, (row.payments?.length || 0) + 2);
      nextAmountAfter = remainingAfter;
    } else {
      const regularInst = targetTotal / nTotal;
      const completedAfter =
        regularInst > 0 ? Math.min(Math.floor((newTotalCollected + 0.005) / regularInst), nTotal - 1) : 0;
      const nextK = completedAfter + 1;
      const candDate = addSchedulePeriodsISO(row.lent_date, sched, nextK);
      nextDateAfter = row.due_date && candDate > row.due_date ? row.due_date : candDate;

      const cumulativeTarget = Math.min(regularInst * nextK, targetTotal);
      const neededForMilestone = Math.max(cumulativeTarget - newTotalCollected, 0);
      nextAmountAfter = Math.min(neededForMilestone > 0.01 ? neededForMilestone : regularInst, remainingAfter);
    }
  }

  const promisedDate = row.next_payment_date || row.due_date;
  let timingType = "on_time";
  let timingDays = 0;
  if (promisedDate) {
    timingDays = Math.round((Date.parse(payDate) - Date.parse(promisedDate)) / 86400000);
    if (timingDays > 0) timingType = "late";
    else if (timingDays < -2) timingType = "early";
  }

  const earlyRebate = Math.max(estAtDue - totalReceivableOnPayDate, 0);
  const lateExtraInterest = Math.max(totalReceivableOnPayDate - estAtDue, 0);

  return {
    payAmt,
    payDate,
    alreadyCollected,
    newTotalCollected,
    interestOnPayDate,
    totalReceivableOnPayDate,
    estAtDue,
    settlesToday,
    remainingAfter,
    nextDateAfter,
    nextAmountAfter,
    finalProjectedTotal,
    timingType,
    timingDays,
    promisedDate,
    earlyRebate,
    lateExtraInterest,
    isPastFinalDue,
  };
}

function estimateLend(f) {
  const P = Number(f.principal_amount) || 0;
  const r = (Number(f.interest_rate) || 0) / 100;
  const manualAmt = Number(f.manual_interest_amount) || 0;
  const isManualOverall = f.interest_type === "manual" && f.rate_period === "overall";
  const periodDays = PERIOD_DAYS[f.rate_period] || PERIOD_DAYS.monthly;
  const hasDue = !f.is_open_ended && f.due_date && f.lent_date;
  const days = hasDue ? Math.max((Date.parse(f.due_date) - Date.parse(f.lent_date)) / 86400000, 0) : null;
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

  // LTV & Collateral metrics
  const collateralVal = Number(f.collateral_estimated_value) || 0;
  const isSecured = f.collateral_type !== "none" && collateralVal > 0;
  const ltvPercent = isSecured && P > 0 ? (P / collateralVal) * 100 : null;
  const coverageRatio = isSecured && P > 0 ? collateralVal / P : null;

  let riskGrade = "Unsecured";
  if (ltvPercent !== null) {
    if (ltvPercent <= 60) riskGrade = "Safe (Low LTV)";
    else if (ltvPercent <= 80) riskGrade = "Moderate LTV";
    else if (ltvPercent <= 100) riskGrade = "High LTV (Tight Margin)";
    else riskGrade = "Under-collateralized (LTV > 100%)";
  }

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
    collateralVal,
    isSecured,
    ltvPercent,
    coverageRatio,
    riskGrade,
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
    tagline: "Fixed % on the amount lent",
  },
  {
    value: "compound",
    title: "Compound interest",
    tagline: "Interest grows on unpaid interest",
  },
  {
    value: "manual",
    title: "Manual / fixed amount",
    tagline: "Fixed ₹ return per period or overall",
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
        The borrower pays interest only on the original {money(P)}{sample ? " (example)" : ""} lent. At {rate || "R"}% per{" "}
        {unit}, you earn <strong>{money(P * (rate / 100))}</strong> every {unit}.{" "}
        <em>Formula: Principal × Rate × Time.</em>
      </p>
    );
  }
  if (form.interest_type === "compound") {
    return (
      <p>
        At the end of every {unit}, unpaid interest is added to the borrower's balance, and the next {unit}'s interest is
        charged on that larger amount. The first {unit} earns {money(P * (rate / 100))}, and each {unit} after earns more.{" "}
        <em>Formula: Principal × ((1 + Rate)^Time − 1).</em>
      </p>
    );
  }
  if (form.rate_period === "overall") {
    return (
      <p>
        You and the borrower agree on one single flat interest return (
        {manualAmt ? <strong>{money(manualAmt)}</strong> : "e.g. ₹2,000"}) for the entire loan, common in short-term
        hand-loans and small finance firms.
      </p>
    );
  }
  return (
    <p>
      You and the borrower agree on a fixed rupee return (
      {manualAmt ? <strong>{money(manualAmt)}</strong> : "e.g. ₹500"}) collected every <strong>{unit}</strong>. Over the
      loan term, total interest earned equals <em>Fixed Amount × Number of {unit}s</em>.
    </p>
  );
}

const CHECKLIST_ITEMS = [
  {
    key: "chk_aadhar_verified",
    label: "Aadhaar card verified (12-digit UID matched with original ID)",
    always: true,
  },
  {
    key: "chk_mobile_verified",
    label: "Mobile number active & reachable (verified via call / message)",
    always: true,
  },
  {
    key: "chk_collateral_inspected",
    label: "Collateral physically inspected, purity/condition & valuation verified",
    collateralOnly: true,
  },
  {
    key: "chk_collateral_possessed",
    label: "Collateral / original title documents received into custody",
    collateralOnly: true,
  },
  {
    key: "chk_agreement_signed",
    label: "Promissory note / loan agreement signed by borrower",
    always: true,
  },
  {
    key: "chk_security_cheque",
    label: "Post-dated security cheque / NACH mandate collected",
    always: true,
  },
  {
    key: "chk_collateral_returned",
    label: "Collateral released & returned to borrower upon full settlement",
    settlementOnly: true,
  },
];

/* ------------------------------------------------------------- form state */

const EMPTY_LEND_FORM = {
  borrower_mode: "existing",
  borrower_id: "",
  new_borrower_name: "",
  new_borrower_phone: "",
  new_borrower_aadhar: "",
  new_borrower_email: "",
  new_borrower_address: "",
  new_borrower_notes: "",
  principal_amount: "",
  lent_date: today(),
  is_open_ended: false,
  due_date: "",
  interest_type: "simple",
  interest_rate: "",
  rate_period: "monthly",
  manual_interest_amount: "",
  repayment_schedule_type: "monthly",
  collateral_type: "none",
  collateral_description: "",
  collateral_estimated_value: "",
  chk_aadhar_verified: false,
  chk_mobile_verified: false,
  chk_collateral_inspected: false,
  chk_collateral_possessed: false,
  chk_agreement_signed: false,
  chk_security_cheque: false,
  chk_collateral_returned: false,
  notes: "",
};

const EMPTY_PAYMENT_FORM = { amount_paid: "", payment_date: today(), notes: "" };

function validateLendForm(f, editingId) {
  if (f.borrower_mode === "existing" && !f.borrower_id) return "Choose a borrower.";
  if (f.borrower_mode === "new" && !editingId) {
    if (!f.new_borrower_name.trim()) return "Enter the borrower's name.";
    if (!f.new_borrower_phone.trim()) return "Enter the borrower's mobile number.";
    const aadharDigits = f.new_borrower_aadhar.replace(/\D/g, "");
    if (!aadharDigits || aadharDigits.length !== 12) {
      return "Enter a valid 12-digit Aadhaar number for borrower verification.";
    }
  }
  if (!(Number(f.principal_amount) > 0)) return "Principal amount must be greater than 0.";
  if (!f.lent_date) return "Enter the lent date.";
  if (!f.is_open_ended) {
    if (!f.due_date) return "Enter a due date, or mark the loan as open-ended.";
    if (f.due_date < f.lent_date) return "Due date cannot be before the lent date.";
  }
  if (f.interest_type === "manual") {
    if (f.manual_interest_amount === "" || Number(f.manual_interest_amount) < 0)
      return "Enter the agreed interest amount (0 if interest-free).";
  } else if (f.interest_rate === "" || Number(f.interest_rate) < 0) {
    return "Enter the interest rate (0 if interest-free).";
  }
  if (f.collateral_type !== "none") {
    if (!(Number(f.collateral_estimated_value) > 0)) {
      return "Enter the estimated market value of the collateral to compute LTV.";
    }
  }
  return "";
}

/* -------------------------------------------------------------- component */

export default function LendPortal({ api, PortalLayout, userMobile, onLogout }) {
  const [lends, setLends] = useState([]);
  const [borrowers, setBorrowers] = useState([]);
  const [summary, setSummary] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [paymentLend, setPaymentLend] = useState(null);
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT_FORM);
  const [form, setForm] = useState(EMPTY_LEND_FORM);
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
  const est = useMemo(() => estimateLend(form), [form]);
  const collectionPreview = useMemo(
    () => computeCollectionPreview(paymentLend, paymentForm),
    [paymentLend, paymentForm]
  );

  const filteredLends = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return lends.filter((r) => {
      if (statusFilter === "active" && r.status === "Paid") return false;
      if (statusFilter === "overdue" && !r.is_overdue && r.schedule_status !== "late") return false;
      if (statusFilter === "paid" && r.status !== "Paid") return false;
      if (!q) return true;
      const hay = [
        r.borrower?.name,
        r.borrower?.phone,
        r.borrower?.aadhar_number,
        r.collateral_description,
        r.collateral_type,
        r.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [lends, searchQuery, statusFilter]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const [lendRes, borrowerRes, summaryRes] = await Promise.all([
        api.get("/lend/", { headers: authHeaders }),
        api.get("/borrowers/", { headers: authHeaders }),
        api.get("/lend/summary/", { headers: authHeaders }),
      ]);
      setLends(parseListPayload(lendRes.data));
      setBorrowers(parseListPayload(borrowerRes.data));
      setSummary(parseObjectPayload(summaryRes.data));
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to load lending data."));
    } finally {
      setLoading(false);
    }
  }, [api, authHeaders]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const closeForm = () => {
    setForm(EMPTY_LEND_FORM);
    setEditingId(null);
    setShowForm(false);
  };

  const openNewForm = () => {
    setForm({ ...EMPTY_LEND_FORM, lent_date: today() });
    setEditingId(null);
    setPaymentLend(null);
    setShowForm(true);
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setPaymentLend(null);
    setShowForm(true);
    setForm({
      ...EMPTY_LEND_FORM,
      borrower_mode: "existing",
      borrower_id: row.borrower?.id || "",
      principal_amount: row.principal_amount,
      lent_date: row.lent_date,
      is_open_ended: !row.due_date,
      due_date: row.due_date || "",
      interest_type: row.interest_type || "simple",
      interest_rate: row.interest_type === "manual" ? "" : String(Number(row.interest_rate)),
      rate_period: row.rate_period || "monthly",
      manual_interest_amount: row.interest_type === "manual" ? String(Number(row.manual_interest_amount)) : "",
      repayment_schedule_type: row.repayment_schedule_type || "monthly",
      collateral_type: row.collateral_type || "none",
      collateral_description: row.collateral_description || "",
      collateral_estimated_value:
        row.collateral_type && row.collateral_type !== "none" ? String(Number(row.collateral_estimated_value || 0)) : "",
      chk_aadhar_verified: Boolean(row.chk_aadhar_verified),
      chk_mobile_verified: Boolean(row.chk_mobile_verified),
      chk_collateral_inspected: Boolean(row.chk_collateral_inspected),
      chk_collateral_possessed: Boolean(row.chk_collateral_possessed),
      chk_agreement_signed: Boolean(row.chk_agreement_signed),
      chk_security_cheque: Boolean(row.chk_security_cheque),
      chk_collateral_returned: Boolean(row.chk_collateral_returned),
      notes: row.notes || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const buildLendPayload = async () => {
    let borrowerId = form.borrower_id;
    if (form.borrower_mode === "new" && !editingId) {
      const borrowerRes = await api.post(
        "/borrowers/",
        {
          name: form.new_borrower_name.trim(),
          phone: form.new_borrower_phone.trim(),
          aadhar_number: form.new_borrower_aadhar.replace(/\D/g, ""),
          email: form.new_borrower_email || "",
          address: form.new_borrower_address || "",
          notes: form.new_borrower_notes || "",
        },
        { headers: authHeaders }
      );
      borrowerId = parseObjectPayload(borrowerRes.data).id;
    }
    const manual = form.interest_type === "manual";
    const hasCollateral = form.collateral_type !== "none";
    return {
      borrower_id: borrowerId,
      principal_amount: Number(form.principal_amount),
      lent_date: form.lent_date,
      due_date: form.is_open_ended ? null : form.due_date,
      interest_type: form.interest_type,
      interest_rate: manual ? 0 : Number(form.interest_rate),
      rate_period: form.rate_period,
      manual_interest_amount: manual ? Number(form.manual_interest_amount) : 0,
      repayment_schedule_type: form.repayment_schedule_type || "monthly",
      collateral_type: form.collateral_type,
      collateral_description: hasCollateral ? form.collateral_description : "",
      collateral_estimated_value: hasCollateral ? Number(form.collateral_estimated_value || 0) : 0,
      chk_aadhar_verified: Boolean(form.chk_aadhar_verified),
      chk_mobile_verified: Boolean(form.chk_mobile_verified),
      chk_collateral_inspected: hasCollateral ? Boolean(form.chk_collateral_inspected) : false,
      chk_collateral_possessed: hasCollateral ? Boolean(form.chk_collateral_possessed) : false,
      chk_agreement_signed: Boolean(form.chk_agreement_signed),
      chk_security_cheque: Boolean(form.chk_security_cheque),
      chk_collateral_returned: Boolean(form.chk_collateral_returned),
      notes: form.notes || "",
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const problem = validateLendForm(form, editingId);
    if (problem) {
      setErrorMessage(problem);
      return;
    }
    setErrorMessage("");
    setSaving(true);
    try {
      const payload = await buildLendPayload();
      if (editingId) await api.put(`/lend/${editingId}/`, payload, { headers: authHeaders });
      else await api.post("/lend/", payload, { headers: authHeaders });
      closeForm();
      await fetchAll();
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to save lending record."));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleChecklistItem = async (row, key) => {
    const nextVal = !row[key];
    try {
      const res = await api.patch(
        `/lend/${row.id}/checklist/`,
        { [key]: nextVal },
        { headers: authHeaders }
      );
      const updated = parseObjectPayload(res.data);
      if (updated) {
        setLends((prev) => prev.map((item) => (item.id === row.id ? updated : item)));
      } else {
        await fetchAll();
      }
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to update verification checklist."));
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Delete the ${money(row.principal_amount)} loan to ${row.borrower?.name}? This cannot be undone.`))
      return;
    try {
      await api.delete(`/lend/${row.id}/`, { headers: authHeaders });
      await fetchAll();
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to delete lending record."));
    }
  };

  const openPayment = (row) => {
    setShowForm(false);
    setPaymentLend(row);
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
    if (!paymentLend) return;
    if (!(Number(paymentForm.amount_paid) > 0)) {
      setErrorMessage("Collection amount must be greater than 0.");
      return;
    }
    if (paymentForm.payment_date < paymentLend.lent_date) {
      setErrorMessage("Collection date cannot be before the lent date.");
      return;
    }
    setErrorMessage("");
    setSaving(true);
    try {
      await api.post(
        `/lend/${paymentLend.id}/payments/`,
        {
          amount_paid: Number(paymentForm.amount_paid),
          payment_date: paymentForm.payment_date,
          notes: paymentForm.notes,
        },
        { headers: authHeaders }
      );
      setPaymentLend(null);
      setPaymentForm(EMPTY_PAYMENT_FORM);
      await fetchAll();
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to record collection."));
    } finally {
      setSaving(false);
    }
  };

  const deletePayment = async (lendId, paymentId) => {
    if (!window.confirm("Delete this collection entry?")) return;
    try {
      await api.delete(`/lend/${lendId}/payments/${paymentId}/`, { headers: authHeaders });
      await fetchAll();
    } catch (err) {
      setErrorMessage(getApiErrorMessage(err, "Failed to delete collection."));
    }
  };

  const unit = PERIOD_UNIT[form.rate_period] || "month";
  const selectedBorrower = useMemo(
    () => borrowers.find((b) => String(b.id) === String(form.borrower_id)),
    [borrowers, form.borrower_id]
  );

  return (
    <PortalLayout userMobile={userMobile} activeTab="lend" onLogout={onLogout}>
      {/* Summary */}
      <div className="borrow-summary-grid">
        <div className="summary-card">
          <span className="summary-card__label">Total Lent</span>
          <span className="summary-card__value">{money(summary?.total_lent)}</span>
          <span className="summary-card__sub">Principal disbursed across all borrowers</span>
        </div>
        <div className="summary-card">
          <span className="summary-card__label">Total Receivable</span>
          <span className="summary-card__value summary-card__value--warn">{money(summary?.total_receivable)}</span>
          <span className="summary-card__sub">Principal + interest owed to you today</span>
        </div>
        <div className="summary-card">
          <span className="summary-card__label">Total Collected</span>
          <span className="summary-card__value summary-card__value--good">{money(summary?.total_collected)}</span>
          <span className="summary-card__sub">All repayments received so far</span>
        </div>
        <div className="summary-card">
          <span className="summary-card__label">Collateral Held / Overdue</span>
          <span className="summary-card__value">{money(summary?.total_collateral_value)}</span>
          <span className="summary-card__sub">
            {summary?.overdue_count ?? 0} overdue loan(s) past due date
          </span>
        </div>
      </div>

      <div className="portal-banner">
        <div className="banner-info">
          <h2>Lending &amp; Collateral Book</h2>
          <p className="banner-subtitle">
            Track money lent, borrower Aadhaar &amp; mobile KYC, collateral LTV coverage, and verification checklists.
          </p>
        </div>
        {!showForm && (
          <button type="button" className="action-btn" onClick={openNewForm}>
            New lending
          </button>
        )}
      </div>

      {errorMessage && <div className="portal-error">{errorMessage}</div>}

      {/* ------------------------------------------------ Add / edit form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="record-form-card" noValidate>
          <div className="form-head">
            <h3>{editingId ? "Edit lending record" : "New lending"}</h3>
            <button type="button" className="link-btn" onClick={closeForm}>
              Cancel
            </button>
          </div>

          {/* 1. Borrower & KYC Details (Aadhaar + Mobile) */}
          <section className="form-section">
            <h4 className="form-section__title">1. Borrower &amp; KYC identity</h4>
            <div className="form-grid">
              {!editingId && (
                <div className="form-field full-width">
                  <label>Borrower Source</label>
                  <div className="radio-group">
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="borrower_mode"
                        value="existing"
                        checked={form.borrower_mode === "existing"}
                        onChange={() => set({ borrower_mode: "existing" })}
                      />
                      Select Existing Borrower
                    </label>
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="borrower_mode"
                        value="new"
                        checked={form.borrower_mode === "new"}
                        onChange={() => set({ borrower_mode: "new" })}
                      />
                      + Register New Borrower (with Aadhaar &amp; Mobile)
                    </label>
                  </div>
                </div>
              )}

              {form.borrower_mode === "existing" || editingId ? (
                <div className="form-field full-width">
                  <label>Select Borrower</label>
                  <select
                    className="form-input"
                    value={form.borrower_id}
                    onChange={(e) => set({ borrower_id: e.target.value })}
                    required
                  >
                    <option value="">-- Choose a borrower --</option>
                    {borrowers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} · 📱 {b.phone} · Aadhaar: {formatAadhar(b.aadhar_number)}
                      </option>
                    ))}
                  </select>
                  {selectedBorrower && (
                    <span className="field-hint">
                      Mobile: <strong>{selectedBorrower.phone}</strong> · Aadhaar UID:{" "}
                      <strong>{formatAadhar(selectedBorrower.aadhar_number)}</strong>
                      {selectedBorrower.address ? ` · Address: ${selectedBorrower.address}` : ""}
                    </span>
                  )}
                </div>
              ) : (
                <>
                  <div className="form-field">
                    <label>Borrower Full Name *</label>
                    <input
                      className="form-input"
                      placeholder="As printed on Aadhaar card"
                      value={form.new_borrower_name}
                      onChange={(e) => set({ new_borrower_name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-field">
                    <label>Mobile Number *</label>
                    <input
                      type="tel"
                      className="form-input"
                      placeholder="e.g. 9876543210"
                      value={form.new_borrower_phone}
                      onChange={(e) => set({ new_borrower_phone: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-field">
                    <label>Aadhaar Number (12 digits) *</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={14}
                      className="form-input"
                      placeholder="XXXX XXXX XXXX"
                      value={form.new_borrower_aadhar}
                      onChange={(e) => set({ new_borrower_aadhar: e.target.value })}
                      required
                    />
                    <span className="field-hint">12-digit UIDAI number for KYC verification.</span>
                  </div>
                  <div className="form-field">
                    <label>Residential Address (optional)</label>
                    <input
                      className="form-input"
                      placeholder="House/Street, City, PIN"
                      value={form.new_borrower_address}
                      onChange={(e) => set({ new_borrower_address: e.target.value })}
                    />
                  </div>
                </>
              )}
            </div>
          </section>

          {/* 2. Amount & Dates */}
          <section className="form-section">
            <h4 className="form-section__title">2. Principal &amp; dates</h4>
            <div className="form-grid">
              <div className="form-field">
                <label>Principal amount lent (₹)</label>
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
                <span className="field-hint">The amount disbursed to the borrower.</span>
              </div>
              <div className="form-field">
                <label>Lent on</label>
                <input
                  type="date"
                  className="form-input"
                  value={form.lent_date}
                  max={form.is_open_ended || !form.due_date ? undefined : form.due_date}
                  onChange={(e) => set({ lent_date: e.target.value })}
                />
              </div>
              <div className="form-field">
                <label>Due date</label>
                <input
                  type="date"
                  className="form-input"
                  disabled={form.is_open_ended}
                  min={form.lent_date || undefined}
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

          {/* 3. Collateral & LTV Risk Assessment */}
          <section className="form-section">
            <h4 className="form-section__title">3. Collateral security &amp; LTV analysis</h4>
            <div className="form-grid">
              <div className="form-field">
                <label>Collateral Type</label>
                <select
                  className="form-input"
                  value={form.collateral_type}
                  onChange={(e) => set({ collateral_type: e.target.value })}
                >
                  {Object.entries(COLLATERAL_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {form.collateral_type !== "none" && (
                <>
                  <div className="form-field">
                    <label>Estimated Market Value of Collateral (₹) *</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      className="form-input"
                      placeholder="e.g. 25000"
                      value={form.collateral_estimated_value}
                      onChange={(e) => set({ collateral_estimated_value: e.target.value })}
                    />
                    {est.ltvPercent !== null && (
                      <span className="field-hint">
                        Loan-to-Value (LTV): <strong>{est.ltvPercent.toFixed(1)}%</strong> · Coverage:{" "}
                        <strong>{est.coverageRatio.toFixed(2)}x</strong> · <strong>{est.riskGrade}</strong>
                      </span>
                    )}
                  </div>
                  <div className="form-field full-width">
                    <label>Collateral Details / Serial / Weight / Document Ref</label>
                    <input
                      className="form-input"
                      placeholder="e.g. 22K Gold Chain 18.5g, or Honda Activa TN-01-AB-1234 original RC book..."
                      value={form.collateral_description}
                      onChange={(e) => set({ collateral_description: e.target.value })}
                    />
                  </div>
                </>
              )}
            </div>
          </section>

          {/* 4. Verification Checklist */}
          <section className="form-section">
            <h4 className="form-section__title">4. KYC, collateral &amp; legal verification checklist</h4>
            <div className="checklist-grid">
              {CHECKLIST_ITEMS.filter(
                (item) =>
                  !item.settlementOnly &&
                  (!item.collateralOnly || form.collateral_type !== "none")
              ).map((item) => (
                <label
                  key={item.key}
                  className={`checklist-card ${form[item.key] ? "checklist-card--checked" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(form[item.key])}
                    onChange={(e) => set({ [item.key]: e.target.checked })}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* 5. Interest & Promised Schedule */}
          <section className="form-section">
            <h4 className="form-section__title">5. Interest &amp; collection schedule</h4>
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
                    <label>Agreed interest return (₹)</label>
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
                  </div>
                </>
              )}

              <div className="form-field">
                <label>Promised collection frequency</label>
                <select
                  className="form-input"
                  value={form.repayment_schedule_type}
                  onChange={(e) => set({ repayment_schedule_type: e.target.value })}
                >
                  <option value="monthly">Monthly collections</option>
                  <option value="weekly">Weekly collections</option>
                  <option value="daily">Daily collections</option>
                  <option value="yearly">Yearly collections</option>
                  <option value="one_time">One-time (full amount on due date)</option>
                </select>
              </div>
            </div>
          </section>

          {/* 6. Estimate */}
          <section className="estimate-panel" aria-live="polite">
            <div className="estimate-row">
              <span>Principal lent</span>
              <span>{money(est.P)}</span>
            </div>
            <div className="estimate-row">
              <span>
                Expected interest return
                {est.t !== null && !est.isManualOverall ? ` over ${plural(est.t, unit)}` : ""}
              </span>
              <span>{est.interest === null ? "—" : money(est.interest)}</span>
            </div>
            {est.installmentAmount !== null && (
              <div className="estimate-row">
                <span>
                  Promised {SCHEDULE_LABEL[form.repayment_schedule_type]?.toLowerCase() || "monthly"} installment (
                  {est.installments} collections)
                </span>
                <span>{money(est.installmentAmount)}</span>
              </div>
            )}
            {est.ltvPercent !== null && (
              <div className="estimate-row">
                <span>Collateral LTV &amp; security coverage</span>
                <span>
                  {est.ltvPercent.toFixed(1)}% LTV · {est.coverageRatio.toFixed(2)}x ({est.riskGrade})
                </span>
              </div>
            )}
            <div className="estimate-row estimate-row--total">
              <span>Estimated total receivable{form.is_open_ended ? "" : " by due date"}</span>
              <span>{est.total === null ? "—" : money(est.total)}</span>
            </div>
          </section>

          <div className="form-field full-width">
            <label>Notes (optional)</label>
            <textarea
              className="form-input"
              rows={2}
              placeholder="Witness details, surety info, or special terms…"
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>

          <div className="form-actions">
            <button type="submit" className="primary-btn" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Save lending"}
            </button>
            <button type="button" className="secondary-btn" onClick={closeForm}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ------------------------------------------------ Record Collection form */}
      {paymentLend && collectionPreview && (
        <form onSubmit={submitPayment} className="record-form-card payment-form-card" noValidate>
          <div className="form-head">
            <h3>Record collection · {paymentLend.borrower?.name}</h3>
            <button type="button" className="link-btn" onClick={() => setPaymentLend(null)}>
              Cancel
            </button>
          </div>

          <div className="promise-summary-bar">
            <div className="promise-summary-item">
              <span className="promise-summary-label">
                Promised Schedule ({SCHEDULE_LABEL[paymentLend.repayment_schedule_type || "monthly"]})
              </span>
              <span className="promise-summary-val">
                {paymentLend.next_payment_amount != null ? money(paymentLend.next_payment_amount) : "—"}
                {paymentLend.next_payment_date && ` due ${fmtDate(paymentLend.next_payment_date)}`}
              </span>
              {paymentLend.total_scheduled_installments > 1 && (
                <span className="promise-summary-sub">
                  Installment {(paymentLend.installments_completed || 0) + 1} of{" "}
                  {paymentLend.total_scheduled_installments}
                </span>
              )}
            </div>
            <div className="promise-summary-item">
              <span className="promise-summary-label">Full Settlement Today (Principal + Accrued Interest)</span>
              <span className="promise-summary-val">
                {money(collectionPreview.totalReceivableOnPayDate - collectionPreview.alreadyCollected)}
              </span>
              <span className="promise-summary-sub">
                Interest accrued to {fmtDate(collectionPreview.payDate)}: {money(collectionPreview.interestOnPayDate)}
              </span>
            </div>
            {paymentLend.estimated_total_at_due != null && (
              <div className="promise-summary-item">
                <span className="promise-summary-label">Scheduled Total at Due Date</span>
                <span className="promise-summary-val">{money(paymentLend.estimated_total_at_due)}</span>
                <span className="promise-summary-sub">
                  Remaining from scheduled total:{" "}
                  {money(Math.max(Number(paymentLend.estimated_total_at_due) - collectionPreview.alreadyCollected, 0))}
                </span>
              </div>
            )}
          </div>

          {/* Early / On-Time / Late Warning Alert */}
          <div className={`schedule-alert schedule-alert--${collectionPreview.timingType}`}>
            {collectionPreview.timingType === "late" && (
              <>
                <span className="schedule-alert__badge">
                  ⚠️ Late Collection ({collectionPreview.timingDays}d past promised date)
                </span>
                <p>
                  This payment is <strong>{collectionPreview.timingDays} day(s)</strong> past the promised date (
                  {fmtDate(collectionPreview.promisedDate)}).
                  {collectionPreview.lateExtraInterest > 0
                    ? ` Additional late interest of ${money(
                        collectionPreview.lateExtraInterest
                      )} has accrued beyond the due-date estimate, bringing total receivable to ${money(
                        collectionPreview.totalReceivableOnPayDate
                      )}.`
                    : ` Collect at least ${money(paymentLend.next_payment_amount)} to bring the borrower back on track.`}
                </p>
              </>
            )}
            {collectionPreview.timingType === "early" && (
              <>
                <span className="schedule-alert__badge">
                  ⚡ Early Collection ({Math.abs(collectionPreview.timingDays)}d ahead of schedule)
                </span>
                <p>
                  Borrower is paying <strong>{Math.abs(collectionPreview.timingDays)} day(s) early</strong> (promised on{" "}
                  {fmtDate(collectionPreview.promisedDate)}).
                  {collectionPreview.earlyRebate > 0
                    ? ` If settling the full loan today (${money(
                        collectionPreview.totalReceivableOnPayDate - collectionPreview.alreadyCollected
                      )}), total receivable is ${money(
                        collectionPreview.totalReceivableOnPayDate
                      )} (${money(collectionPreview.earlyRebate)} less unearned future interest).`
                    : ` Early collection reduces the outstanding principal exposure ahead of schedule.`}
                </p>
              </>
            )}
            {collectionPreview.timingType === "on_time" && (
              <>
                <span className="schedule-alert__badge">✓ On Track with Promised Schedule</span>
                <p>
                  Promised installment due on <strong>{fmtDate(collectionPreview.promisedDate)}</strong>:{" "}
                  <strong>{money(paymentLend.next_payment_amount)}</strong>.
                </p>
              </>
            )}
          </div>

          <div className="form-grid">
            <div className="form-field">
              <label>Amount collected (₹)</label>
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
                {paymentLend.next_payment_amount != null && Number(paymentLend.next_payment_amount) > 0 && (
                  <button
                    type="button"
                    className="link-btn link-btn--inline"
                    onClick={() =>
                      setPaymentForm({
                        ...paymentForm,
                        amount_paid: String(Number(paymentLend.next_payment_amount)),
                      })
                    }
                  >
                    Collect promised ({money(paymentLend.next_payment_amount)})
                  </button>
                )}
                {collectionPreview.totalReceivableOnPayDate - collectionPreview.alreadyCollected > 0 && (
                  <button
                    type="button"
                    className="link-btn link-btn--inline"
                    onClick={() =>
                      setPaymentForm({
                        ...paymentForm,
                        amount_paid: String(
                          Number((collectionPreview.totalReceivableOnPayDate - collectionPreview.alreadyCollected).toFixed(2))
                        ),
                      })
                    }
                  >
                    Settle full today ({money(collectionPreview.totalReceivableOnPayDate - collectionPreview.alreadyCollected)})
                  </button>
                )}
              </div>
            </div>
            <div className="form-field">
              <label>Collection date</label>
              <input
                type="date"
                className="form-input"
                min={paymentLend.lent_date}
                value={paymentForm.payment_date}
                onChange={(e) => setPaymentForm({ ...paymentForm, payment_date: e.target.value })}
              />
            </div>
            <div className="form-field full-width">
              <label>Reference (optional)</label>
              <input
                className="form-input"
                placeholder="UPI ref, bank transfer, cash receipt…"
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
              />
            </div>
          </div>

          {collectionPreview.payAmt > 0 && (
            <section className="estimate-panel payment-impact-panel" aria-live="polite">
              <h4 className="form-section__title" style={{ marginBottom: "8px" }}>
                Calculation after this {money(collectionPreview.payAmt)} collection
              </h4>
              <div className="estimate-row">
                <span>Total collected (including this payment)</span>
                <span className="text-good">{money(collectionPreview.newTotalCollected)}</span>
              </div>
              <div className="estimate-row">
                <span>Remaining receivable after this</span>
                <span className="text-bold">{money(collectionPreview.remainingAfter)}</span>
              </div>
              <div className="estimate-row">
                <span>Next collection promised after this</span>
                <span>
                  {collectionPreview.settlesToday
                    ? "None — Loan will be fully settled! 🎉 (Remember to release collateral)"
                    : `${money(collectionPreview.nextAmountAfter)}${
                        collectionPreview.nextDateAfter ? ` on ${fmtDate(collectionPreview.nextDateAfter)}` : ""
                      }`}
                </span>
              </div>
              <div className="estimate-row estimate-row--total">
                <span>
                  {collectionPreview.settlesToday
                    ? "Final total collected for this loan"
                    : collectionPreview.isPastFinalDue
                    ? "Updated total receivable (with late interest)"
                    : "Projected total receivable (if paid on schedule)"}
                </span>
                <span>{money(collectionPreview.finalProjectedTotal)}</span>
              </div>
            </section>
          )}

          <div className="form-actions">
            <button type="submit" className="primary-btn" disabled={saving}>
              {saving ? "Saving…" : "Record collection"}
            </button>
          </div>
        </form>
      )}

      {/* ------------------------------------------------ Table */}
      <div className="borrow-table-wrap">
        {!loading && lends.length > 0 && (
          <div className="ledger-toolbar">
            <div className="ledger-search-wrap">
              <span className="ledger-search-icon" aria-hidden="true">⌕</span>
              <input
                type="search"
                className="ledger-search-input"
                placeholder="Search borrower, Aadhaar UID, mobile, or collateral…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="ledger-filter-pills" role="tablist" aria-label="Filter lending records">
              {[
                { key: "all", label: `All (${lends.length})` },
                { key: "active", label: `Active (${lends.filter((l) => l.status !== "Paid").length})` },
                {
                  key: "overdue",
                  label: `Attention (${lends.filter((l) => l.is_overdue || l.schedule_status === "late").length})`,
                },
                { key: "paid", label: `Settled (${lends.filter((l) => l.status === "Paid").length})` },
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
        {!loading && lends.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">◈</span>
            <h3>No lending records yet</h3>
            <p>Add your first loan with "New lending".</p>
          </div>
        )}
        {!loading && lends.length > 0 && filteredLends.length === 0 && (
          <div className="empty-state">
            <h3>No matching lending records</h3>
            <p>Try clearing your search or switching the status filter.</p>
          </div>
        )}

        {!loading && filteredLends.length > 0 && (
          <table className="borrow-table">
            <thead>
              <tr>
                <th aria-label="Expand" style={{ width: "32px" }} />
                <th>Borrower &amp; KYC</th>
                <th className="cell-num">Principal</th>
                <th>Collateral &amp; LTV</th>
                <th>Checklist</th>
                <th>Next Promised</th>
                <th className="cell-num">Total at due</th>
                <th className="cell-num">Collected</th>
                <th className="cell-num">Receivable</th>
                <th>Status</th>
                <th className="cell-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredLends.map((row) => {
                const expanded = expandedId === row.id;
                const paid = row.status === "Paid";
                const badge = paid ? "badge-paid" : row.status === "Partial" ? "badge-partial" : "badge-unpaid";
                const hasCollateral = row.collateral_type && row.collateral_type !== "none";
                const allVerified = row.checklist_completed === row.checklist_total;
                const denom = Number(row.total_payable_to_date || row.principal_amount || 1);
                const collectedPct = Math.min(
                  100,
                  Math.round((Number(row.total_paid || 0) / Math.max(denom, 1)) * 100)
                );

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
                        <div className="cell-lender">{row.borrower?.name || "—"}</div>
                        <div className="cell-sub">
                          📱 {row.borrower?.phone || "—"} · ID: {formatAadhar(row.borrower?.aadhar_number)}
                        </div>
                      </td>
                      <td className="cell-num">
                        <div>{money(row.principal_amount)}</div>
                        <div className="cell-sub">{interestSummary(row)}</div>
                      </td>
                      <td>
                        {hasCollateral ? (
                          <div>
                            <div className="cell-sub-strong">{COLLATERAL_LABELS[row.collateral_type]}</div>
                            <div className="cell-sub">
                              Val: {money(row.collateral_estimated_value)}
                              {row.ltv_percent != null && ` · LTV ${Number(row.ltv_percent).toFixed(0)}%`}
                            </div>
                          </div>
                        ) : (
                          <span className="open-ended-tag">Unsecured</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`schedule-pill ${
                            allVerified ? "schedule-pill--early" : "schedule-pill--soon"
                          }`}
                          title="Click row to toggle verification checklist items"
                        >
                          {allVerified ? "✓" : "📋"} {row.checklist_completed}/{row.checklist_total} verified
                        </span>
                      </td>
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
                        <div className="progress-track" title={`${collectedPct}% collected`}>
                          <div className="progress-fill" style={{ width: `${paid ? 100 : collectedPct}%` }} />
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
                            <span className="schedule-pill schedule-pill--early">⚡ Settled early</span>
                          )}
                          {row.schedule_status === "settled_late" && (
                            <span className="overdue-warning-pill">
                              ⚠️ Settled late (+{money(row.late_extra_interest)})
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
                            Collect
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
                        <td colSpan={11}>
                          <div className="borrow-detail-panel">
                            {/* Column 1: Borrower KYC & Collateral Valuation */}
                            <div className="detail-section">
                              <h4>Borrower KYC &amp; Collateral</h4>
                              <KV label="Name" value={row.borrower?.name} strong />
                              <KV label="Mobile" value={row.borrower?.phone} />
                              <KV label="Aadhaar UID" value={formatAadhar(row.borrower?.aadhar_number)} strong />
                              {row.borrower?.address && <KV label="Address" value={row.borrower.address} />}
                              <hr className="detail-divider" />
                              <KV label="Collateral Type" value={COLLATERAL_LABELS[row.collateral_type || "none"]} />
                              {hasCollateral && (
                                <>
                                  <KV
                                    label="Estimated Value"
                                    value={money(row.collateral_estimated_value)}
                                    strong
                                  />
                                  {row.collateral_description && (
                                    <KV label="Asset Details" value={row.collateral_description} />
                                  )}
                                  {row.ltv_percent != null && (
                                    <KV label="Loan-to-Value (LTV)" value={`${Number(row.ltv_percent).toFixed(1)}%`} />
                                  )}
                                  {row.collateral_coverage_ratio != null && (
                                    <KV
                                      label="Security Coverage"
                                      value={`${Number(row.collateral_coverage_ratio).toFixed(2)}x (${row.risk_grade})`}
                                    />
                                  )}
                                </>
                              )}
                              {row.notes && <KV label="Notes" value={row.notes} />}
                            </div>

                            {/* Column 2: Financial Calculation & Schedule */}
                            <div className="detail-section">
                              <h4>Financials &amp; Schedule</h4>
                              <KV label="Principal Lent" value={money(row.principal_amount)} />
                              <KV label="Lent Date" value={fmtDate(row.lent_date)} />
                              <KV label="Due Date" value={row.due_date ? fmtDate(row.due_date) : "Open-ended"} />
                              <KV label="Interest" value={interestSummary(row)} />
                              <KV
                                label="Collection Frequency"
                                value={SCHEDULE_LABEL[row.repayment_schedule_type || "monthly"]}
                              />
                              {row.due_date && (
                                <>
                                  <KV label="Interest at Due Date" value={money(row.estimated_interest_at_due)} />
                                  <KV label="Total at Due Date" value={money(row.estimated_total_at_due)} strong />
                                </>
                              )}
                              <hr className="detail-divider" />
                              <KV
                                label={row.settled_on ? `Interest (settled ${fmtDate(row.settled_on)})` : "Interest Accrued So Far"}
                                value={money(row.accrued_interest)}
                              />
                              <KV label="Receivable So Far" value={money(row.total_payable_to_date)} />
                              <KV label="Total Collected" value={money(row.total_paid)} />
                              <KV label="Remaining Receivable" value={money(row.remaining_balance)} strong />
                              {!paid && row.next_payment_amount != null && (
                                <KV
                                  label="Next Promised Collection"
                                  value={`${money(row.next_payment_amount)}${
                                    row.next_payment_date ? ` on ${fmtDate(row.next_payment_date)}` : ""
                                  }`}
                                  strong
                                />
                              )}
                              {Number(row.late_extra_interest) > 0 && (
                                <KV label="Extra Late Interest" value={`+${money(row.late_extra_interest)}`} />
                              )}
                            </div>

                            {/* Column 3: Interactive Verification Checklist + Collection Ledger */}
                            <div className="detail-section detail-section--wide">
                              <h4>
                                Verification &amp; Due-Diligence Checklist ({row.checklist_completed}/
                                {row.checklist_total} verified)
                              </h4>
                              <div className="checklist-grid checklist-grid--compact">
                                {CHECKLIST_ITEMS.filter(
                                  (item) =>
                                    (!item.collateralOnly || hasCollateral) &&
                                    (!item.settlementOnly || hasCollateral)
                                ).map((item) => (
                                  <label
                                    key={item.key}
                                    className={`checklist-card ${row[item.key] ? "checklist-card--checked" : ""}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={Boolean(row[item.key])}
                                      onChange={() => handleToggleChecklistItem(row, item.key)}
                                    />
                                    <span>{item.label}</span>
                                  </label>
                                ))}
                              </div>

                              <hr className="detail-divider" style={{ margin: "14px 0" }} />

                              <div className="ledger-header-row">
                                <h4>Collections Ledger ({row.payments?.length || 0})</h4>
                              </div>
                              {(row.payments || []).length === 0 ? (
                                <p className="muted-text">No collections recorded yet.</p>
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
                                            title="Delete collection"
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
