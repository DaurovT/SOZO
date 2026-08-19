import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { KanbanPage } from './pages/Kanban';
import { LanesPage } from './pages/Lanes';
import { CapacityPage } from './pages/Capacity';
import { NewOrderPage } from './pages/NewOrder';
import { ArchivePage } from './pages/Archive';
import { ReplacementsPage } from './pages/Replacements';
import { IncidentsPage } from './pages/Incidents';
import { ClientRequestsPage } from './pages/ClientRequests';
import { ComplaintsPage } from './pages/Complaints';
import { DisputesPage } from './pages/Disputes';
import { HandoverPage } from './pages/Handover';
import { KpiPage } from './pages/Kpi';
import { MapPage } from './pages/Map';
import { PermitsPage } from './pages/Permits';

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/kanban" element={<KanbanPage />} />
            <Route path="/lanes" element={<LanesPage />} />
            <Route path="/capacity" element={<CapacityPage />} />
            <Route path="/orders/new" element={<NewOrderPage />} />
            <Route path="/archive" element={<ArchivePage />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/replacements" element={<ReplacementsPage />} />
            <Route path="/incidents" element={<IncidentsPage />} />
            <Route path="/client-requests" element={<ClientRequestsPage />} />
            <Route path="/complaints" element={<ComplaintsPage />} />
            <Route path="/disputes" element={<DisputesPage />} />
            <Route path="/handover" element={<HandoverPage />} />
            <Route path="/kpi" element={<KpiPage />} />
            <Route path="/permits" element={<PermitsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
