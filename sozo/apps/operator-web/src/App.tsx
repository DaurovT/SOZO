import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { getOrgId, getToken } from './auth';
import { useFetch } from './useFetch';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Permits } from './pages/Permits';
import { Finance } from './pages/Finance';
import { Login } from './pages/Login';
import { FirstRefusal } from './pages/FirstRefusal';
import { Settings } from './pages/Settings';
import { Units } from './pages/Units';
import { Observations } from './pages/Observations';
import { Shutdowns } from './pages/Shutdowns';
import { Journal } from './pages/Journal';
import { CommonOrders } from './pages/CommonOrders';
import { Passport } from './pages/Passport';
import { TechDebt } from './pages/TechDebt';
import { Subscription } from './pages/Subscription';
import { People } from './pages/People';
import { Reports } from './pages/Reports';
import type { Dashboard as DashboardData } from './types';

export function App() {
  const token = getToken();
  const org = getOrgId();
  // Тариф нужен сайдбару: от него зависит, что написано про сервисный сбор
  const dash = useFetch<DashboardData>(token && org ? `/operator/${org}/dashboard` : null);

  if (!token) return <Login />;

  return (
    <BrowserRouter basename="/operator">
      <Layout plan={dash.data?.plan}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/permits" element={<Permits />} />
          <Route path="/finance" element={<Finance />} />
          <Route path="/first-refusal" element={<FirstRefusal />} />
          <Route path="/observations" element={<Observations />} />
          <Route path="/shutdowns" element={<Shutdowns />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/units" element={<Units />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/orders" element={<CommonOrders />} />
          <Route path="/passport" element={<Passport />} />
          <Route path="/tech-debt" element={<TechDebt />} />
          <Route path="/subscription" element={<Subscription />} />
          <Route path="/people" element={<People />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
