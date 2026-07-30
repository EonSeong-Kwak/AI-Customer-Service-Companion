import React, { useState, useEffect } from 'react'
import { Typography, Table, Button, Space, Modal, Form, Input, App, Popconfirm, Tag, Row, Col, Select } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import axios from 'axios'
import { API_BASE } from './constants'

const { TextArea } = Input

// ===== V6.0: 练习节点题目镜像表管理 =====
const PracticeNodeQuestionsTab = () => {
  const { message } = App.useApp()
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(false)
  const [businessLines, setBusinessLines] = useState([])
  const [filterLine, setFilterLine] = useState(undefined)
  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()

  const fetchBusinessLines = async () => {
    try {
      const res = await axios.get(`${API_BASE}/prewarm/status`)
      setBusinessLines(res.data?.business_lines || [])
    } catch (e) {
      // 拿不到真实业务线列表时不报错打扰，下拉框允许手动输入兜底
    }
  }

  const fetchNodes = async (businessLine) => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/practice-nodes`, { params: businessLine ? { business_line: businessLine } : {} })
      setNodes(res.data || [])
    } catch (e) {
      message.error('加载题目镜像表失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchBusinessLines(); fetchNodes() }, [])

  const openModal = (row = null) => {
    setEditing(row)
    if (row) {
      form.setFieldsValue({ ...row, key_points_text: (row.key_points || []).join('、') })
    } else {
      form.resetFields()
      form.setFieldsValue({ business_line: filterLine, order_index: nodes.length, difficulty: 'medium' })
    }
    setModalVisible(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const { key_points_text, ...rest } = values
      const payload = { ...rest, key_points: (key_points_text || '').split(/[、,，]/).map(k => k.trim()).filter(Boolean) }
      if (editing) {
        const { business_line, ...updatable } = payload
        await axios.put(`${API_BASE}/practice-nodes/${editing.id}`, updatable)
        message.success('更新成功（如改动了题干/答案/得分点，同步状态已自动重置为「未同步」）')
      } else {
        await axios.post(`${API_BASE}/practice-nodes`, payload)
        message.success('新增成功，记得手动同步到 Coze 工作流编辑器')
      }
      setModalVisible(false)
      fetchNodes(filterLine)
    } catch (e) {
      if (e.response?.data?.detail) message.error('保存失败: ' + e.response.data.detail)
    }
  }

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API_BASE}/practice-nodes/${id}`)
      message.success('已删除')
      fetchNodes(filterLine)
    } catch (e) {
      message.error('删除失败: ' + (e.response?.data?.detail || e.message))
    }
  }

  const handleMarkSynced = async (id) => {
    try {
      await axios.post(`${API_BASE}/practice-nodes/${id}/mark-synced`)
      message.success('已标记为已同步')
      fetchNodes(filterLine)
    } catch (e) {
      message.error('标记失败: ' + (e.response?.data?.detail || e.message))
    }
  }

  const columns = [
    { title: '业务线', dataIndex: 'business_line', key: 'business_line', width: 110, render: v => <Tag color="blue">{v}</Tag> },
    { title: '顺序', dataIndex: 'order_index', key: 'order_index', width: 60 },
    { title: '节点标识', dataIndex: 'node_key', key: 'node_key', width: 110, render: v => v || <Typography.Text type="secondary">-</Typography.Text> },
    { title: '题干', dataIndex: 'question_text', key: 'question_text', ellipsis: true },
    { title: '参考答案', dataIndex: 'reference_answer', key: 'reference_answer', ellipsis: true },
    { title: '得分点', dataIndex: 'key_points', key: 'key_points', width: 180, render: kps => (kps || []).map(k => <Tag key={k}>{k}</Tag>) },
    {
      title: '同步状态', dataIndex: 'sync_status', key: 'sync_status', width: 100,
      render: v => v === 'synced' ? <Tag color="success">已同步</Tag> : <Tag color="warning">未同步</Tag>
    },
    {
      title: '操作', key: 'action', width: 200,
      render: (_, r) => (
        <Space size="small">
          <Button size="small" icon={<EditOutlined />} onClick={() => openModal(r)}>编辑</Button>
          {r.sync_status !== 'synced' && (
            <Button size="small" onClick={() => handleMarkSynced(r.id)}>标记已同步</Button>
          )}
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Select
            allowClear
            showSearch
            style={{ width: 220 }}
            placeholder="按业务线筛选"
            value={filterLine}
            onChange={(v) => { setFilterLine(v); fetchNodes(v) }}
            options={businessLines.map(bl => ({ label: bl, value: bl }))}
            filterOption={(input, option) => (option?.label ?? '').includes(input)}
          />
          <Button onClick={() => fetchNodes(filterLine)} loading={loading}>刷新</Button>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>新增题目</Button>
      </div>
      <Typography.Paragraph type="secondary">
        这是我方对 Coze 工作流各节点内容的独立副本：既是评分依据（按「顺序」对齐每轮问答），也是本地兜底题库，
        更是你往 Coze 控制台手动粘贴文案时的标准文本来源——Coze 工作流节点内容目前没有开放 API 可以程序化修改，改完这里之后仍需手动同步。
      </Typography.Paragraph>
      <Table dataSource={nodes} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 8 }} />

      <Modal
        title={editing ? '编辑题目' : '新增题目'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => setModalVisible(false)}
        width={700}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="business_line" label="业务线" rules={[{ required: true, message: '请输入业务线' }]}>
                <Input disabled={!!editing} placeholder="如：卡片挂失" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="order_index" label="顺序" rules={[{ required: true, message: '请输入顺序' }]} tooltip="打分时按这个顺序和考生对话轮次对齐，务必和 Coze 工作流节点的实际先后顺序一致">
                <Input type="number" min={0} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="difficulty" label="难度">
                <Select options={[{ value: 'easy', label: '简单' }, { value: 'medium', label: '中等' }, { value: 'hard', label: '困难' }]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="node_key" label="节点标识（可选）" tooltip="自行对照 Coze 工作流里的节点标题/ID 填写，仅供人工核对，不参与打分逻辑">
            <Input placeholder="如：挂失受理" />
          </Form.Item>
          <Form.Item name="question_text" label="题干（练习模式下原样提问）" rules={[{ required: true, message: '请输入题干' }]}>
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="reference_answer" label="参考答案" rules={[{ required: true, message: '请输入参考答案' }]}>
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="key_points_text" label="得分点（用、或,分隔）" rules={[{ required: true, message: '请至少填写一个得分点' }]}>
            <Input placeholder="如：礼貌用语、告知时间" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default PracticeNodeQuestionsTab
