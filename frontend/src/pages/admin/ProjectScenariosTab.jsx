import React, { useState, useEffect } from 'react'
import { Typography, Table, Button, Space, Modal, Form, Input, App, Popconfirm, Tag, Row, Col, Select } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import axios from 'axios'
import { API_BASE } from './constants'

const { TextArea } = Input

// ===== V3.4: 项目场景配置（PBL）子组件 =====
const ProjectScenariosTab = () => {
  const { message } = App.useApp()
  const [scenarios, setScenarios] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingScenario, setEditingScenario] = useState(null)
  const [businessLines, setBusinessLines] = useState([])
  const [form] = Form.useForm()

  const fetchScenarios = async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/project-scenarios`)
      setScenarios(res.data || [])
    } catch (e) {
      message.error('加载项目场景失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setLoading(false)
    }
  }

  const fetchBusinessLines = async () => {
    try {
      const res = await axios.get(`${API_BASE}/prewarm/status`)
      setBusinessLines(res.data?.business_lines || [])
    } catch (e) {
      // 拿不到真实业务线列表时不报错打扰，下拉框允许手动输入兜底
    }
  }

  useEffect(() => {
    fetchScenarios()
    fetchBusinessLines()
  }, [])

  const openModal = (scenario = null) => {
    setEditingScenario(scenario)
    if (scenario) {
      form.setFieldsValue({
        name: scenario.name,
        description: scenario.description,
        business_line: scenario.business_line,
        tasks_json: JSON.stringify(scenario.tasks || [], null, 2),
        difficulty: scenario.difficulty,
        enabled: scenario.enabled
      })
    } else {
      form.resetFields()
      form.setFieldsValue({ difficulty: 'medium', enabled: true, tasks_json: '[]' })
    }
    setModalVisible(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      let tasks = []
      try {
        tasks = JSON.parse(values.tasks_json || '[]')
      } catch {
        message.error('任务列表 JSON 格式错误，请检查')
        return
      }

      const payload = {
        name: values.name,
        description: values.description,
        business_line: values.business_line,
        tasks,
        difficulty: values.difficulty,
        enabled: values.enabled
      }

      if (editingScenario) {
        await axios.put(`${API_BASE}/project-scenarios/${editingScenario.id}`, payload)
        message.success('更新成功')
      } else {
        await axios.post(`${API_BASE}/project-scenarios`, payload)
        message.success('创建成功')
      }
      setModalVisible(false)
      fetchScenarios()
    } catch (e) {
      if (e.response?.data?.detail) {
        message.error('保存失败: ' + e.response.data.detail)
      }
    }
  }

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API_BASE}/project-scenarios/${id}`)
      message.success('已删除')
      fetchScenarios()
    } catch (e) {
      message.error('删除失败: ' + (e.response?.data?.detail || e.message))
    }
  }

  const columns = [
    { title: '项目名称', dataIndex: 'name', key: 'name', width: 180 },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: '业务线', dataIndex: 'business_line', key: 'business_line', width: 120, render: v => v ? <Tag color="blue">{v}</Tag> : '-' },
    { title: '任务数', key: 'task_count', width: 80, render: (_, r) => (r.tasks?.length || 0) },
    {
      title: '难度', dataIndex: 'difficulty', key: 'difficulty', width: 80,
      render: v => {
        const map = { easy: { color: 'green', text: '简单' }, medium: { color: 'orange', text: '中等' }, hard: { color: 'red', text: '困难' } }
        const m = map[v] || { color: 'default', text: v }
        return <Tag color={m.color}>{m.text}</Tag>
      }
    },
    {
      title: '启用', dataIndex: 'enabled', key: 'enabled', width: 80,
      render: v => v ? <Tag color="success">启用</Tag> : <Tag color="default">禁用</Tag>
    },
    {
      title: '操作', key: 'action', width: 150,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openModal(r)}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
          新增项目场景
        </Button>
        <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
          PBL 项目制：配置多任务流程，考试时客户按任务顺序推进
        </Typography.Text>
      </div>

      <Table
        dataSource={scenarios}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 8 }}
      />

      <Modal
        title={editingScenario ? "编辑项目场景" : "新增项目场景"}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => setModalVisible(false)}
        width={800}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
            <Input placeholder="如：完整投诉处理流程" />
          </Form.Item>
          <Form.Item name="description" label="项目描述">
            <TextArea rows={2} placeholder="项目场景的描述" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="business_line" label="关联业务线" rules={[{ required: true, message: '请选择关联业务线' }]}>
                <Select
                  showSearch
                  allowClear
                  placeholder="选择系统已识别的业务线"
                  options={businessLines.map(bl => ({ label: bl, value: bl }))}
                  filterOption={(input, option) => (option?.label ?? '').includes(input)}
                  notFoundContent="暂无数据，请先在顶部点击「重新预热业务线」"
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="difficulty" label="难度">
                <Select options={[
                  { value: 'easy', label: '简单' },
                  { value: 'medium', label: '中等' },
                  { value: 'hard', label: '困难' }
                ]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="enabled" label="是否启用">
                <Select options={[
                  { value: true, label: '启用' },
                  { value: false, label: '禁用' }
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="tasks_json"
            label="任务列表（JSON 格式）"
            extra="每个任务包含：name(名称)、weight(权重)、success_criteria(成功标准关键词数组)、intents(意图列表)"
          >
            <TextArea
              rows={12}
              placeholder={`[
  {
    "name": "接待并安抚情绪",
    "weight": 0.3,
    "success_criteria": ["抱歉", "理解", "帮您"],
    "intents": [
      {"name": "表达不满", "success_criteria": ["丢", "收费"], "description": "客户愤怒表达不满"},
      {"name": "接受安抚", "success_criteria": ["好", "行"], "description": "客户情绪平复"}
    ]
  }
]`}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default ProjectScenariosTab
