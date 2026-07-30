import React, { useState } from 'react'
import { Layout, Menu, Typography, Avatar, Space, Tooltip, Badge, Dropdown, Tag } from 'antd'
import {
  UserOutlined,
  SettingOutlined,
  BankOutlined,
  ThunderboltOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  BellOutlined,
  DashboardOutlined,
  MessageOutlined,
  LogoutOutlined,
  DownOutlined,
  CrownOutlined,
  TeamOutlined,
  BookOutlined,
} from '@ant-design/icons'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const { Header, Sider, Content } = Layout
const { Text } = Typography

const MainLayout = ({ collapsed, setCollapsed }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout, isAdmin } = useAuth()
  const [adminOpenKeys, setAdminOpenKeys] = useState(['admin-content'])

  const getSelectedKey = () => {
    if (location.pathname.includes('admin')) return 'admin-dashboard'
    if (location.pathname.includes('wrong-notebook')) return 'wrong-notebook'
    if (location.pathname.includes('dynamic-exam') || location.pathname.includes('coze-practice')) return 'dynamic-exam'
    return 'trainee'
  }

  const traineeMenuItems = [
    {
      key: 'trainee',
      icon: <DashboardOutlined />,
      label: '学习中心',
      onClick: () => navigate('/trainee'),
    },
    {
      key: 'dynamic-exam',
      icon: <ThunderboltOutlined />,
      label: '模拟考试',
      onClick: () => navigate('/dynamic-exam'),
    },
    {
      key: 'wrong-notebook',
      icon: <BookOutlined />,
      label: '错题本',
      onClick: () => navigate('/wrong-notebook'),
    },
  ]

  const adminMenuItems = [
    {
      key: 'admin-group',
      icon: <SettingOutlined />,
      label: '管理后台',
      children: [
        { key: 'admin-dashboard', icon: <DashboardOutlined />, label: '配置大厅', onClick: () => navigate('/admin') },
      ],
    },
  ]

  const menuItems = isAdmin() ? [...traineeMenuItems, ...adminMenuItems] : traineeMenuItems

  const pageTitle = {
    '/trainee': '学习中心',
    '/dynamic-exam': '模拟考试',
    '/wrong-notebook': '错题本',
    '/admin': '管理后台',
  }
  const currentTitle = Object.keys(pageTitle).find(k => location.pathname.startsWith(k))
  const headerTitle = pageTitle[currentTitle] || '工作台'

  const userMenuItems = [
    {
      key: 'profile',
      disabled: true,
      label: (
        <div style={{ padding: '8px 0 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0' }}>
            <Avatar
              size={44}
              icon={<UserOutlined />}
              style={{
                backgroundColor: isAdmin() ? '#722ed1' : '#1677ff',
                boxShadow: isAdmin()
                  ? '0 0 0 3px rgba(114,46,209,0.2)'
                  : '0 0 0 3px rgba(22,119,255,0.2)',
              }}
            />
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1f2937' }}>
                {user?.username}
              </div>
              <Tag
                icon={isAdmin() ? <CrownOutlined /> : <TeamOutlined />}
                color={isAdmin() ? 'purple' : 'blue'}
                style={{ marginTop: 4, margin: 0 }}
              >
                {isAdmin() ? '管理员' : '学员'}
              </Tag>
            </div>
          </div>
        </div>
      ),
    },
    { type: 'divider' },
    {
      key: 'role-info',
      disabled: true,
      label: (
        <div style={{ fontSize: 12, color: '#6b7280', padding: '4px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>角色权限</span>
            <span style={{ color: isAdmin() ? '#722ed1' : '#1677ff', fontWeight: 500 }}>
              {isAdmin() ? '全部功能' : '学习中心 + 模拟考试'}
            </span>
          </div>
        </div>
      ),
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: () => {
        logout()
        navigate('/login')
      },
      danger: true,
    },
  ]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={220}
        collapsedWidth={64}
        theme="dark"
        style={{
          overflow: 'hidden',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
        }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? 0 : '0 20px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <BankOutlined style={{ fontSize: collapsed ? 22 : 24, color: '#1677ff', flexShrink: 0 }} />
          {!collapsed && (
            <div style={{ marginLeft: 12, overflow: 'hidden', whiteSpace: 'nowrap' }}>
              <div style={{ color: '#fff', fontSize: 15, fontWeight: 600, letterSpacing: '0.5px', lineHeight: 1.3 }}>
                AI智能客服
              </div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, letterSpacing: '0.5px' }}>陪练系统 v1.0</div>
            </div>
          )}
        </div>

        <div style={{ padding: '16px 8px', height: 'calc(100vh - 64px - 48px)', overflowY: 'auto' }}>
          {!collapsed && (
            <div
              style={{
                color: 'rgba(255,255,255,0.35)',
                fontSize: 11,
                padding: '0 12px 8px',
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}
            >
              {isAdmin() ? '工作台' : '学习工作台'}
            </div>
          )}
          <Menu
            mode="inline"
            theme="dark"
            selectedKeys={[getSelectedKey()]}
            openKeys={isAdmin() && !collapsed ? adminOpenKeys : []}
            onOpenChange={(keys) => setAdminOpenKeys(keys)}
            items={menuItems}
            style={{
              borderRight: 0,
              background: 'transparent',
            }}
          />
        </div>

        <div
          onClick={() => setCollapsed(!collapsed)}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.45)',
            transition: 'all 0.2s',
            background: '#002140',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
        >
          {collapsed ? <MenuUnfoldOutlined style={{ fontSize: 16 }} /> : <MenuFoldOutlined style={{ fontSize: 16 }} />}
        </div>
      </Sider>

      <Layout style={{ marginLeft: collapsed ? 64 : 220, transition: 'margin-left 0.2s' }}>
        <Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 28px',
            background: '#ffffff',
            boxShadow: '0 1px 4px rgba(0,21,41,0.08)',
            position: 'sticky',
            top: 0,
            zIndex: 99,
            height: 64,
          }}
        >
          <Space size={12} align="center">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MessageOutlined style={{ fontSize: 18, color: '#1677ff' }} />
              <Text strong style={{ fontSize: 16, color: '#1f2937' }}>{headerTitle}</Text>
            </div>
          </Space>

          <Space size={20} align="center">
            <Tooltip title="通知">
              <Badge count={3} size="small" offset={[-2, 2]}>
                <BellOutlined style={{ fontSize: 18, color: '#6b7280', cursor: 'pointer' }} />
              </Badge>
            </Tooltip>
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" trigger={['click']}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 14px 6px 6px',
                  borderRadius: 24,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  background: 'linear-gradient(135deg, rgba(22,119,255,0.08) 0%, rgba(114,46,209,0.08) 100%)',
                  border: '1px solid rgba(0,0,0,0.04)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'linear-gradient(135deg, rgba(22,119,255,0.12) 0%, rgba(114,46,209,0.12) 100%)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'linear-gradient(135deg, rgba(22,119,255,0.08) 0%, rgba(114,46,209,0.08) 100%)')}
              >
                <div
                  style={{
                    padding: 2,
                    borderRadius: '50%',
                    background: isAdmin()
                      ? 'linear-gradient(135deg, #722ed1, #9254de)'
                      : 'linear-gradient(135deg, #1677ff, #4096ff)',
                  }}
                >
                  <Avatar
                    size={30}
                    style={{ backgroundColor: '#fff' }}
                    icon={<UserOutlined style={{ color: isAdmin() ? '#722ed1' : '#1677ff' }} />}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#1f2937', fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                    {user?.username}
                  </div>
                  <Tag
                    icon={isAdmin() ? <CrownOutlined /> : <TeamOutlined />}
                    color={isAdmin() ? 'purple' : 'blue'}
                    style={{ fontSize: 10, lineHeight: '16px', padding: '0 6px', height: 18, marginTop: 2 }}
                  >
                    {isAdmin() ? '管理员' : '学员'}
                  </Tag>
                </div>
                <DownOutlined style={{ fontSize: 10, color: '#9ca3af', marginLeft: 2 }} />
              </div>
            </Dropdown>
          </Space>
        </Header>

        <Content
          style={{
            padding: '24px 28px',
            minHeight: 'calc(100vh - 64px)',
            background: '#f5f7fa',
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

export default MainLayout
