import React, { useState, useEffect } from 'react'
import { Typography, Table, Button, Space, Modal, Form, Input, message, Popconfirm, Tag, Row, Col, Checkbox } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import axios from 'axios'
import { API_BASE } from './constants'

const { TextArea } = Input

// ===== V6.0: Coze 工作流注册表管理 =====
const CozeWorkflowRegistryTab = () => {
  const [registries, setRegistries] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()

  const fetchRegistries = async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/coze-workflows`)
      setRegistries(res.data || [])
    } catch (e) {
      message.error('加载工作流注册表失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRegistries() }, [])

  const openModal = (row = null) => {
    setEditing(row)
    if (row) {
      form.setFieldsValue(row)
    } else {
      form.resetFields()
      form.setFieldsValue({ mode_param_key: 'mode', practice_mode_value: 'practice', tongguan_mode_value: 'tongguan', enabled: true })
    }
    setModalVisible(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      if (editing) {
        const { business_line, ...updatable } = values
        await axios.put(`${API_BASE}/coze-workflows/${editing.id}`, updatable)
        message.success('更新成功')
      } else {
        await axios.post(`${API_BASE}/coze-workflows`, values)
        message.success('注册成功')
      }
      setModalVisible(false)
      fetchRegistries()
    } catch (e) {
      if (e.response?.data?.detail) message.error('保存失败: ' + e.response.data.detail)
    }
  }

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API_BASE}/coze-workflows/${id}`)
      message.success('已删除，该业务线将自动降级为本地兜底题库')
      fetchRegistries()
    } catch (e) {
      message.error('删除失败: ' + (e.response?.data?.detail || e.message))
    }
  }

  const columns = [
    { title: '业务线', dataIndex: 'business_line', key: 'business_line', width: 140, render: v => <Tag color="blue">{v}</Tag> },
    { title: 'Workflow ID', dataIndex: 'workflow_id', key: 'workflow_id', ellipsis: true },
    { title: 'Bot ID', dataIndex: 'bot_id', key: 'bot_id', width: 140, render: v => v || <Typography.Text type="secondary">-</Typography.Text> },
    { title: 'App ID', dataIndex: 'app_id', key: 'app_id', width: 140, render: v => v || <Typography.Text type="secondary">-</Typography.Text> },
    {
      title: '模式参数', key: 'mode_params', width: 220,
      render: (_, r) => <span style={{ fontSize: 12 }}>{r.mode_param_key} = {r.practice_mode_value} / {r.tongguan_mode_value}</span>
    },
    {
      title: '状态', dataIndex: 'enabled', key: 'enabled', width: 90,
      render: v => v ? <Tag color="success">已启用</Tag> : <Tag color="default">已禁用（走本地兜底）</Tag>
    },
    {
      title: '操作', key: 'action', width: 150,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openModal(r)}>编辑</Button>
          <Popconfirm title="确定删除？删除后该业务线将自动降级为本地兜底题库" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>注册工作流</Button>
        <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
          维护业务线 ↔ Coze 工作流 ID 的对应关系。未注册或已禁用的业务线，考生端「情景陪练」会自动降级为本地题库，不影响练习体验。
        </Typography.Text>
      </div>
      <Table dataSource={registries} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 8 }} />

      <Modal
        title={editing ? '编辑工作流注册' : '注册工作流'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => setModalVisible(false)}
        width={600}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="business_line" label="业务线" rules={[{ required: true, message: '请输入业务线名称' }]}>
            <Input placeholder="如：卡片挂失" disabled={!!editing} />
          </Form.Item>
          <Form.Item name="workflow_id" label="Coze Workflow ID" rules={[{ required: true, message: '请输入 workflow_id' }]}>
            <Input placeholder="从 Coze 工作流页面 URL 里的 workflow_id 参数复制" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="bot_id" label="Bot ID（可选）">
                <Input placeholder="不填则使用全局默认" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="app_id" label="App ID（可选，与 Bot ID 二选一）">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="mode_param_key" label="模式参数名">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="practice_mode_value" label="练习模式取值">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="tongguan_mode_value" label="通关模式取值">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="enabled" label="是否启用" valuePropName="checked" initialValue={true}>
            <Checkbox>启用（关闭后自动走本地兜底题库，不影响考生练习）</Checkbox>
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <TextArea rows={2} placeholder="联调状态、注意事项等，仅管理员可见" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default CozeWorkflowRegistryTab
