import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, theme } from 'antd'

// 简单的布局和页面占位
import MainLayout from './components/MainLayout'
import AdminDashboard from './pages/AdminDashboard'
import TraineePortal from './pages/TraineePortal'
import DynamicExam from './pages/DynamicExam'

function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1d39c4', // 银行主题深蓝色
          colorInfo: '#1d39c4',
          colorSuccess: '#52c41a',
          colorWarning: '#faad14',
          colorError: '#f5222d',
          borderRadius: 8, // 全局圆角
          wireframe: false,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        },
        components: {
          Layout: {
            headerBg: '#001529',
            headerColor: '#fff',
            siderBg: '#fff',
          },
          Card: {
            headerBg: '#fafafa',
          }
        }
      }}
    >
      <div style={{ width: '100%', minHeight: '100vh' }}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<MainLayout />}>
              <Route index element={<Navigate to="/trainee" replace />} />
              <Route path="admin" element={<AdminDashboard />} />
              <Route path="trainee" element={<TraineePortal />} />
              <Route path="dynamic-exam" element={<DynamicExam />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </div>
    </ConfigProvider>
  )
}

export default App
