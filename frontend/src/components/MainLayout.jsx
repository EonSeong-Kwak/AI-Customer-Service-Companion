import React from 'react'
import { Layout, Menu, Typography, Avatar, Space } from 'antd'
import { UserOutlined, SettingOutlined, BankOutlined, RobotOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

const MainLayout = () => {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Header style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        padding: '0 24px',
        background: '#001529',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 10
      }}>
        <Space size="middle">
          <BankOutlined style={{ fontSize: 24, color: '#1677ff' }} />
          <Title level={4} style={{ color: '#fff', margin: 0, letterSpacing: '1px' }}>
            AI 智能客服陪练系统 <Text type="secondary" style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>v1.0</Text>
          </Title>
        </Space>
        
        <Space size="large">
          <Space style={{ color: '#fff', cursor: 'pointer' }}>
            <Avatar style={{ backgroundColor: '#1677ff' }} icon={<UserOutlined />} />
            <span>工号: 10086</span>
          </Space>
        </Space>
      </Header>
      
      <Layout>
        <Sider 
          width={220} 
          theme="light"
          style={{ 
            boxShadow: '2px 0 8px rgba(0,0,0,0.05)',
            zIndex: 9
          }}
        >
          <div style={{ padding: '20px 16px', borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 8, fontWeight: 500 }}>工作台</div>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[location.pathname.includes('admin') ? 'admin' : location.pathname.includes('dynamic-exam') ? 'dynamic-exam' : 'trainee']}
            style={{ borderRight: 0, padding: '8px' }}
            items={[
              {
                key: 'trainee',
                icon: <RobotOutlined />,
                label: '考生端 (练习/考试)',
                onClick: () => navigate('/trainee'),
                style: { borderRadius: 8, marginBottom: 4 }
              },
              {
                key: 'dynamic-exam',
                icon: <ThunderboltOutlined />,
                label: '动态模拟考试',
                onClick: () => navigate('/dynamic-exam'),
                style: { borderRadius: 8, marginBottom: 4 }
              },
              {
                key: 'admin',
                icon: <SettingOutlined />,
                label: '管理员端 (配置)',
                onClick: () => navigate('/admin'),
                style: { borderRadius: 8 }
              }
            ]}
          />
        </Sider>
        
        <Layout style={{ padding: '24px' }}>
          <Content style={{ 
            background: 'transparent',
            margin: 0, 
            minHeight: 280,
            maxWidth: '100%',
            width: '100%',
          }}>
            <Outlet />
          </Content>
        </Layout>
      </Layout>
    </Layout>
  )
}

export default MainLayout
