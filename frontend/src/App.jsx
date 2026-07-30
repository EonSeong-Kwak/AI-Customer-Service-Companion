import React, { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, theme, Spin, App as AntdApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'

import { AuthProvider, useAuth } from './context/AuthContext'
import MainLayout from './components/MainLayout'
import LoginPage from './pages/LoginPage'
import AdminDashboard from './pages/AdminDashboard'
import TraineePortal from './pages/TraineePortal'
import DynamicExamHub from './pages/DynamicExamHub'
import WrongNotebook from './pages/WrongNotebook'

function ProtectedRoute({ children, requireAdmin }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (requireAdmin && user.role !== 'admin') return <Navigate to="/trainee" replace />
  return children
}

function AppRoutes() {
  const [collapsed, setCollapsed] = useState(false)
  const { user } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={user.role === 'admin' ? '/admin' : '/trainee'} replace /> : <LoginPage />} />
      <Route path="/" element={
        <ProtectedRoute>
          <MainLayout collapsed={collapsed} setCollapsed={setCollapsed} />
        </ProtectedRoute>
      }>
        <Route index element={<Navigate to={user?.role === 'admin' ? '/admin' : '/trainee'} replace />} />
        <Route path="trainee" element={<TraineePortal />} />
        <Route path="dynamic-exam" element={<DynamicExamHub />} />
        <Route path="wrong-notebook" element={<WrongNotebook />} />
        <Route path="coze-practice" element={<Navigate to="/dynamic-exam?tab=coze" replace />} />
        <Route path="coze-practice-admin" element={<Navigate to="/admin" replace />} />
        <Route path="admin" element={
          <ProtectedRoute requireAdmin>
            <AdminDashboard />
          </ProtectedRoute>
        } />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          colorInfo: '#1677ff',
          colorSuccess: '#52c41a',
          colorWarning: '#faad14',
          colorError: '#ff4d4f',
          borderRadius: 10,
          wireframe: false,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
          fontSize: 14,
          colorBgLayout: '#f5f7fa',
          colorBgContainer: '#ffffff',
          colorBorder: '#e8ecf1',
          colorBorderSecondary: '#f0f2f5',
          boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03), 0 1px 6px -1px rgba(0,0,0,0.02), 0 2px 4px 0 rgba(0,0,0,0.02)',
          boxShadowSecondary: '0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12), 0 9px 28px 8px rgba(0,0,0,0.05)',
        },
        components: {
          Layout: {
            headerBg: '#ffffff',
            headerColor: '#1f2937',
            headerHeight: 64,
            headerPadding: '0 24px',
            siderBg: '#001529',
            bodyBg: '#f5f7fa',
            triggerBg: '#002140',
            triggerColor: '#fff',
          },
          Menu: {
            darkItemBg: 'transparent',
            darkSubMenuItemBg: 'transparent',
            darkItemSelectedBg: '#1677ff',
            darkItemHoverBg: 'rgba(22,119,255,0.15)',
            darkItemColor: 'rgba(255,255,255,0.65)',
            darkItemSelectedColor: '#fff',
            darkItemHoverColor: '#fff',
            itemBorderRadius: 8,
            itemMarginInline: 8,
            itemHeight: 44,
          },
          Card: {
            headerBg: 'transparent',
            borderRadiusLG: 12,
            boxShadowTertiary: '0 1px 2px 0 rgba(0,0,0,0.03), 0 1px 6px -1px rgba(0,0,0,0.02), 0 2px 4px 0 rgba(0,0,0,0.02)',
          },
          Button: {
            borderRadius: 8,
            controlHeight: 36,
            fontWeight: 500,
          },
          Table: {
            headerBg: '#fafbfc',
            headerColor: '#4b5563',
            rowHoverBg: '#f8fafc',
            borderColor: '#f0f2f5',
          },
          Tabs: {
            titleFontSize: 15,
            itemSelectedColor: '#1677ff',
            itemHoverColor: '#4096ff',
            inkBarColor: '#1677ff',
          },
          Modal: {
            borderRadiusLG: 14,
            headerBg: 'transparent',
          },
          Tag: {
            borderRadiusSM: 6,
          },
          Statistic: {
            titleFontSize: 14,
            contentFontSize: 28,
          },
        },
      }}
    >
      <AntdApp>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  )
}

export default App
