import { useState, useEffect } from "react";
import axios from "axios";

function App() {
  const [loans, setLoans] = useState([]);
  const [form, setForm] = useState({
    name: "",
    amount: "",
    interest_rate: "",
    loan_type: "BORROW",
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
      });
    } catch (err) {
      console.error("Failed to create loan", err);
    }
  };

  return (
    <div style={{ padding: "30px" }}>
      <h1>Finance Manager</h1>

      <h3>Add Loan</h3>
      <form onSubmit={handleSubmit}>
        <input
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />

        <input
          placeholder="Amount"
          type="number"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
        />

        <input
          placeholder="Interest %"
          type="number"
          value={form.interest_rate}
          onChange={(e) =>
            setForm({ ...form, interest_rate: e.target.value })
          }
        />

        <select
          value={form.loan_type}
          onChange={(e) => setForm({ ...form, loan_type: e.target.value })}
        >
          <option value="BORROW">Borrow</option>
          <option value="LEND">Lend</option>
        </select>

        <button type="submit">Add</button>
      </form>

      <h3>Loan List</h3>
      <ul>
        {loans.map((loan) => (
          <li key={loan.id}>
            {loan.name} - {loan.loan_type} - ₹{loan.total_amount}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;