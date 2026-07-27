import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Button } from '@carbon/react';
import { ArrowLeft } from '@carbon/icons-react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AppShell } from './components/AppShell';
import { PageSkeleton } from './components/PageState';
import { CreateShipmentPage } from './pages/CreateShipmentPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { PublicTrackPage } from './pages/PublicTrackPage';
import { ShipmentDetailPage } from './pages/ShipmentDetailPage';
import { ShipmentsPage } from './pages/ShipmentsPage';
import { VerifyPage } from './pages/VerifyPage';

function ProtectedRoute() {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) return <PageSkeleton rows={5} />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <AppShell />;
}

function NotFoundPage() {
  return (
    <main className="not-found-page">
      <p className="eyebrow">页面不存在</p>
      <h1>没有找到这个页面</h1>
      <p>检查地址，或返回公开物流查询。</p>
      <Button as="a" href="/track" renderIcon={ArrowLeft}>
        返回物流查询
      </Button>
    </main>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/track" replace />} />
      <Route path="/track" element={<PublicTrackPage />} />
      <Route path="/verify" element={<VerifyPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/app" element={<ProtectedRoute />}>
        <Route index element={<DashboardPage />} />
        <Route path="shipments" element={<ShipmentsPage />} />
        <Route path="shipments/new" element={<CreateShipmentPage />} />
        <Route path="shipments/:id" element={<ShipmentDetailPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
