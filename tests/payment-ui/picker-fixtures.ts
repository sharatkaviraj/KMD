import { student } from "../payment-parity.fixture";

// Manufactured pupils only. Deliberately wide names and balances.
export const pickerStudents = [
  { ...student, id: "00000000-0000-4000-8000-000000000101", name: "TEST Te Paid Child", sr: "TEST-9101", pendingToday: 0, lateFee: 0 },
  { ...student, id: "00000000-0000-4000-8000-000000000102", name: "TEST Te Pending Chandrashekhar Rajeshwar Singh", sr: "TEST-9102", pendingToday: 98765432, lateFee: 0 },
  { ...student, id: "00000000-0000-4000-8000-000000000103", name: "TEST Te Late Chandrashekhar Rajeshwar Singh", sr: "TEST-9103", pendingToday: 98765432, lateFee: 1234567 },
  { ...student, id: "00000000-0000-4000-8000-000000000104", name: "TEST Te शुल्क शेष विद्यार्थी चन्द्रशेखर राजेश्वर सिंह", sr: "TEST-9104", pendingToday: 0, lateFee: 1234567 },
];
