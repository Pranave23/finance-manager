import { useState, useEffect } from "react";
import axios from "axios";
import "./App.css";

function App() {
  const [loans, setLoans] = useState([]);
  const [form, setForm] = useState({
    name: "",
    amount: "",
    interest_rate: "",
    loan_type: "BORROW",
    interest_period: "YEARLY",
  });

  const fetchLoans = async () => {
    try {
      const res = await axios.get("http://127.0.0.1:8000/api/loan/list/");
      setLoans(res.data);
    } catch (err) {
      console.error("Failed to fetch loans", err);
    }
  };

  useEffect(() => {
    fetchLoans();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post("http://127.0.0.1:8000/api/loan/create/", {
        ...form,
        amount: Number(form.amount),
        interest_rate: Number(form.interest_rate),
      });
      await fetchLoans();
      setForm({
        name: "",
        amount: "",
        interest_rate: "",
        loan_type: "BORROW",
        interest_period: "YEARLY",
      });
    } catch (err) {
      console.error("Failed to create loan", err);
    }
  };

  // Separate loans by type
  const borrowLoans = loans.filter((loan) => loan.loan_type === "BORROW");
  const lendLoans = loans.filter((loan) => loan.loan_type === "LEND");

  const getInterestAmount = (loan) => {
    if (!loan) return 0;
    const total = Number(loan.total_amount ?? 0);
    const principal = Number(loan.amount ?? 0);
    return total - principal;
  };

  const formatPeriodLabel = (period) => {
    switch (period) {
      case "DAILY":
        return "per day";
      case "WEEKLY":
        return "per week";
      case "MONTHLY":
        return "per month";
      case "YEARLY":
        return "per year";
      default:
        return period?.toLowerCase() || "";
    }
  };

  const handleDelete = async (id) => {
    const confirmDelete = window.confirm(
      "Are you sure you want to delete this loan?"
    );
    if (!confirmDelete) return;

    try {
      await axios.delete(`http://127.0.0.1:8000/api/loan/delete/${id}/`);
      await fetchLoans();
    } catch (err) {
      console.error("Failed to delete loan", err);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Finance Manager</h1>

        <h3>Add Loan</h3>
        <form onSubmit={handleSubmit} className="App-form">
          <input
            className="App-input"
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoComplete="off"
          />

          <input
            className="App-input"
            placeholder="Amount"
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            min={0}
            step="any"
          />

          <input
            className="App-input"
            placeholder="Interest %"
            type="number"
            value={form.interest_rate}
            onChange={(e) =>
              setForm({ ...form, interest_rate: e.target.value })
            }
            min={0}
            step="any"
          />

          <select
            className="App-input"
            value={form.interest_period}
            onChange={(e) =>
              setForm({ ...form, interest_period: e.target.value })
            }
          >
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </select>

          <select
            className="App-input"
            value={form.loan_type}
            onChange={(e) => setForm({ ...form, loan_type: e.target.value })}
          >
            <option value="BORROW">Borrow</option>
            <option value="LEND">Lend</option>
          </select>

          <button className="App-link" type="submit">
            Add
          </button>
        </form>

        <div className="loan-lists-container">
          <div className="borrow-list">
            <h3>Borrowed Loans</h3>
            <ul>
              {borrowLoans.length === 0 && <li>No borrowed loans</li>}
              {borrowLoans.map((loan) => (
                <li
                  key={loan.id}
                  style={{
                    background: "#fef3c7",
                  }}
                >
                  <div className="loan-card">
                    <div className="loan-title-row">
                      <span className="loan-type loan-type--borrow">Borrow</span>
                    </div>
                    <div className="loan-meta-row">
                      <span className="loan-label">Name:</span>
                      <span className="loan-value loan-name">{loan.name}</span>
                    </div>
                    <div className="loan-meta-row">
                      <span className="loan-label">Actual amount:</span>
                      <span className="loan-value">₹{loan.amount}</span>
                    </div>
                    <div className="loan-meta-row">
                      <span className="loan-label">Interest rate:</span>
                      <span className="loan-value">
                        {loan.interest_rate}%
                      </span>
                    </div>
                    <div className="loan-meta-row">
                      <span className="loan-label">Time period:</span>
                      <span className="loan-value">
                        {loan.interest_period} {formatPeriodLabel(loan.interest_period)}
                      </span>
                    </div>
                    <div className="loan-meta-row loan-meta-row--highlight">
                      <span className="loan-label">
                        Interest amount for this period:
                      </span>
                      <span className="loan-value">
                        ₹{getInterestAmount(loan)}
                      </span>
                    </div>
                    <div className="loan-actions-row">
                      <button
                        type="button"
                        className="loan-delete-button"
                        onClick={() => handleDelete(loan.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="lend-list">
            <h3>Lent Loans</h3>
            <ul>
              {lendLoans.length === 0 && <li>No lent loans</li>}
              {lendLoans.map((loan) => (
                <li
                  key={loan.id}
                  style={{
                    background: "#cffafe",
                  }}
                >
                  <div className="loan-card">
                    <div className="loan-title-row">
                      <span className="loan-type loan-type--lend">Lend</span>
                    </div>
                    <div className="loan-meta-row">
                      <span className="loan-label">Name:</span>
                      <span className="loan-value loan-name">{loan.name}</span>
                    </div>
                    <div className="loan-meta-row">
                      <span className="loan-label">Actual amount:</span>
                      <span className="loan-value">₹{loan.amount}</span>
                    </div>
                    <div className="loan-meta-row">
                      <span className="loan-label">Interest rate:</span>
                      <span className="loan-value">
                        {loan.interest_rate}%
                      </span>
                    </div>
                    <div className="loan-meta-row">
                      <span className="loan-label">Time period:</span>
                      <span className="loan-value">
                        {loan.interest_period} {formatPeriodLabel(loan.interest_period)}
                      </span>
                    </div>
                    <div className="loan-meta-row loan-meta-row--highlight">
                      <span className="loan-label">
                        Interest amount for this period:
                      </span>
                      <span className="loan-value">
                        ₹{getInterestAmount(loan)}
                      </span>
                    </div>
                    <div className="loan-actions-row">
                      <button
                        type="button"
                        className="loan-delete-button"
                        onClick={() => handleDelete(loan.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </header>
    </div>
  );
}

export default App;