import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { getOrgId, getToken } from './auth';
import { useFetch } from './useFetch';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Permits } from './pages/Permits';
import { Finance } from './pages/Finance';
import { Login } from './pages/Login';
import { Stub } from './pages/Stub';
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
          <Route
            path="/first-refusal"
            element={<Stub title="Первая рука" note="Экран собирается следующим — API уже отдаёт очередь заявок в окне первой руки" />}
          />
          <Route
            path="/observations"
            element={<Stub title="Замечания и обходы" note="Экран собирается следом за первой рукой" />}
          />
          <Route
            path="/shutdowns"
            element={<Stub title="Отключения" note="Экран собирается следом за замечаниями" />}
          />
          <Route
            path="/settings"
            element={<Stub title="Настройки объекта" note="Экран собирается следом — чек-лист готовности уже считается на сервере" />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
