import "./index.css";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Auth } from "./pages/Auth";
import Dashboard from "./pages/Dashboard";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<Auth />} /> 
        <Route path="/dashboard" element={<Dashboard />} /> 
      </Routes>
    </BrowserRouter>
  );
}

export default App;
