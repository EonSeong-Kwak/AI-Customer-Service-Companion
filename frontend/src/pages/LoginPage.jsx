import React, { useState } from 'react'
import { Card, Form, Input, Button, Tabs, Typography, App, Space } from 'antd'
import { UserOutlined, LockOutlined, BankOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const { Title, Text } = Typography

const LoginPage = () => {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('login')
  const { login, register } = useAuth()
  const navigate = useNavigate()
  const [loginForm] = Form.useForm()
  const [registerForm] = Form.useForm()

  const onLogin = async (values) => {
    setLoading(true)
    try {
      const user = await login(values.username, values.password)
      message.success(`欢迎回来，${user.username}！`)
      navigate(user.role === 'admin' ? '/admin' : '/trainee')
    } catch (err) {
      message.error(err.response?.data?.detail || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  const onRegister = async (values) => {
    setLoading(true)
    try {
      const user = await register(values.username, values.password)
      const isFirst = user.role === 'admin'
      message.success(isFirst
        ? `注册成功！您是系统首位用户，已自动成为管理员。`
        : '注册成功！')
      navigate(isFirst ? '/admin' : '/trainee')
    } catch (err) {
      message.error(err.response?.data?.detail || '注册失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: 20,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* 装饰元素 */}
      <div style={{ position: 'absolute', top: -100, left: -100, width: 300, height: 300, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
      <div style={{ position: 'absolute', bottom: -80, right: -80, width: 260, height: 260, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
      <div style={{ position: 'absolute', top: '20%', right: '15%', fontSize: 80, opacity: 0.08, color: '#fff' }}>
        <ThunderboltOutlined />
      </div>

      <div style={{ display: 'flex', width: '100%', maxWidth: 900, borderRadius: 20, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        {/* 左侧品牌区 */}
        <div style={{
          flex: 1,
          background: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
          padding: '48px 40px',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          minHeight: 500,
        }}>
          <Space align="center" size={12} style={{ marginBottom: 24 }}>
            <BankOutlined style={{ fontSize: 36 }} />
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '0.5px' }}>AI 智能客服</div>
              <div style={{ fontSize: 13, opacity: 0.8, letterSpacing: '1px' }}>陪练系统 v1.0</div>
            </div>
          </Space>
          <Title level={3} style={{ color: '#fff', marginBottom: 16, fontWeight: 600 }}>
            沉浸式 AI 客服实训平台
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 1.8, display: 'block', marginBottom: 24 }}>
            通过 AI 角色扮演客户，模拟真实服务场景，多维度评分即时反馈，帮助客服团队快速提升专业能力。
          </Text>
          <Space orientation="vertical" size={10} style={{ opacity: 0.9 }}>
            <Space size={8}><ThunderboltOutlined style={{ fontSize: 14 }} /> <span style={{ fontSize: 13 }}>AI 人格模拟 · 真实感训练</span></Space>
            <Space size={8}><ThunderboltOutlined style={{ fontSize: 14 }} /> <span style={{ fontSize: 13 }}>五维评分 · 精准诊断</span></Space>
            <Space size={8}><ThunderboltOutlined style={{ fontSize: 14 }} /> <span style={{ fontSize: 13 }}>知识库驱动 · 持续进化</span></Space>
          </Space>
        </div>

        {/* 右侧表单区 */}
        <div style={{ flex: 1, background: '#fff', padding: '40px 36px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            centered
            size="large"
            items={[
              {
                key: 'login',
                label: '登录',
                children: (
                  <Form form={loginForm} onFinish={onLogin} layout="vertical" size="large" style={{ marginTop: 12 }}>
                    <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                      <Input prefix={<UserOutlined style={{ color: '#bfbfbf' }} />} placeholder="用户名" />
                    </Form.Item>
                    <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                      <Input.Password prefix={<LockOutlined style={{ color: '#bfbfbf' }} />} placeholder="密码" />
                    </Form.Item>
                    <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
                      <Button type="primary" htmlType="submit" loading={loading} block style={{ height: 44, borderRadius: 10, fontWeight: 600 }}>
                        登 录
                      </Button>
                    </Form.Item>
                  </Form>
                ),
              },
              {
                key: 'register',
                label: '注册',
                children: (
                  <Form form={registerForm} onFinish={onRegister} layout="vertical" size="large" style={{ marginTop: 12 }}>
                    <Form.Item name="username" rules={[
                      { required: true, message: '请输入用户名' },
                      { min: 2, message: '用户名至少2个字符' },
                    ]}>
                      <Input prefix={<UserOutlined style={{ color: '#bfbfbf' }} />} placeholder="用户名（2-50个字符）" />
                    </Form.Item>
                    <Form.Item name="password" rules={[
                      { required: true, message: '请输入密码' },
                      { min: 6, message: '密码至少6个字符' },
                    ]}>
                      <Input.Password prefix={<LockOutlined style={{ color: '#bfbfbf' }} />} placeholder="密码（至少6位）" />
                    </Form.Item>
                    <Form.Item
                      name="confirm"
                      dependencies={['password']}
                      rules={[
                        { required: true, message: '请确认密码' },
                        ({ getFieldValue }) => ({
                          validator(_, value) {
                            if (!value || getFieldValue('password') === value) return Promise.resolve()
                            return Promise.reject(new Error('两次密码不一致'))
                          },
                        }),
                      ]}
                    >
                      <Input.Password prefix={<LockOutlined style={{ color: '#bfbfbf' }} />} placeholder="确认密码" />
                    </Form.Item>
                    <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
                      <Button type="primary" htmlType="submit" loading={loading} block style={{ height: 44, borderRadius: 10, fontWeight: 600 }}>
                        注 册
                      </Button>
                    </Form.Item>
                    <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: '#8c8c8c' }}>
                      首次注册将自动成为系统管理员
                    </div>
                  </Form>
                ),
              },
            ]}
          />
        </div>
      </div>
    </div>
  )
}

export default LoginPage
