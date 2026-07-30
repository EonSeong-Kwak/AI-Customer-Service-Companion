import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, theme } from 'antd'

// 简单的布局和页面占位
import MainLayout from './components/MainLayout'
import AdminDashboard from './pages/AdminDashboard'
import TraineePortal from './pages/TraineePortal'
import DynamicExamHub from './pages/DynamicExamHub'

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
              <Route path="dynamic-exam" element={<DynamicExamHub />} />
              {/* 情景陪练(Coze)已收拢进"动态模拟考试"里的一个板块，旧链接重定向过去并预选中对应板块 */}
              <Route path="coze-practice" element={<Navigate to="/dynamic-exam?tab=coze" replace />} />
              {/* Coze 工作流管理页与"管理员端"里的 Coze工作流注册/情景陪练题目管理/陪练题目AI起草 三个模块完全重复，已合并，旧链接跳去管理员端 */}
              <Route path="coze-practice-admin" element={<Navigate to="/admin" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </div>
    </ConfigProvider>
  )
}

export default App
