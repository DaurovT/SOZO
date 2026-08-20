import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { getOrgId, getToken } from './auth';
import { useFetch } from './useFetch';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Permits } from './pages/Permits';
import { Finance } from './pages/Finance';
import { Login } from './pages/Login';
import { Stub } from './pages/Stub';
import { FirstRefusal } from './pages/FirstRefusal';
import { Settings } from './pages/Settings';
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
          <Route
            path="/observations"
            element={<Stub title="Замечания и обходы" note="Экран собирается следом за первой рукой" />}
          />
          <Route
            path="/shutdowns"
            element={<Stub title="Отключения" note="Экран собирается следом за замечаниями" />}
          />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
