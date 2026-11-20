import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

const CommandCenterPage = lazy(() => import('./pages/command-center/CommandCenterPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const StaffPage = lazy(() => import('./pages/StaffPage'));
const PlanPage = lazy(() => import('./pages/plan/PlanPage'));
const LivePage = lazy(() => import('./pages/live/LivePage'));
const ReplayPage = lazy(() => import('./pages/replay/ReplayPage'));
const AuditPage = lazy(() => import('./pages/audit/AuditPage'));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="app-loading">正在加载 SkyGuard…</div>}>
        <Routes>
          <Route path="/" element={<Navigate to="/legacy" replace />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/live" element={<LivePage />} />
          <Route path="/replay" element={<ReplayPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/legacy" element={<CommandCenterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="*" element={<Navigate to="/legacy" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
