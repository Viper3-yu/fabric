import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Button } from '@carbon/react';
import { ArrowLeft } from '@carbon/icons-react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageSkeleton } from './components/PageState';
import { PublicTrackPage } from './pages/PublicTrackPage';

// The workbench pages sit behind auth and pull in heavy dependencies (maps,
// spreadsheets); keep them out of the bundle public visitors download first.
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
);
const ShipmentsPage = lazy(() =>
  import('./pages/ShipmentsPage').then((module) => ({ default: module.ShipmentsPage })),
);
const CreateShipmentPage = lazy(() =>
  import('./pages/CreateShipmentPage').then((module) => ({ default: module.CreateShipmentPage })),
);
const ShipmentDetailPage = lazy(() =>
  import('./pages/ShipmentDetailPage').then((module) => ({ default: module.ShipmentDetailPage })),
);
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })),
);
const VerifyPage = lazy(() =>
  import('./pages/VerifyPage').then((module) => ({ default: module.VerifyPage })),
);

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
      <Button as={Link} to="/track" renderIcon={ArrowLeft}>
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
      <Route
        path="/verify"
        element={
          <Suspense fallback={<PageSkeleton rows={3} />}>
            <VerifyPage />
          </Suspense>
        }
      />
      <Route
        path="/login"
        element={
          <Suspense fallback={<PageSkeleton rows={3} />}>
            <LoginPage />
          </Suspense>
        }
      />
      <Route path="/app" element={<ProtectedRoute />}>
        <Route
          index
          element={
            <Suspense fallback={<PageSkeleton rows={5} />}>
              <DashboardPage />
            </Suspense>
          }
        />
        <Route
          path="shipments"
          element={
            <Suspense fallback={<PageSkeleton rows={4} />}>
              <ShipmentsPage />
            </Suspense>
          }
        />
        <Route
          path="shipments/new"
          element={
            <Suspense fallback={<PageSkeleton rows={4} />}>
              <CreateShipmentPage />
            </Suspense>
          }
        />
        <Route
          path="shipments/:id"
          element={
            <Suspense fallback={<PageSkeleton rows={4} />}>
              <ShipmentDetailPage />
            </Suspense>
          }
        />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ErrorBoundary>
  );
}
