import { BrowserRouter, Route, Routes } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import MainApp from "./pages/MainApp";
import AnalyzingPage from "./pages/AnalyzingPage";
import NotFound from "./pages/NotFound";
import { AppProvider } from "./context/AppContext";

const App = () => (
  <AppProvider>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app" element={<MainApp />} />
        <Route path="/analyzing" element={<AnalyzingPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </AppProvider>
);

export default App;
