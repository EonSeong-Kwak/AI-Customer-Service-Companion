import React, { useState, useEffect } from 'react'
import { Typography, Table, Button, Space, Modal, Form, Input, message, Tag, Select, AutoComplete } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import axios from 'axios'
import { API_BASE } from './constants'

const { TextArea } = Input

// ===== V6.0: AI 起草练习题草稿审核 =====
const PracticeQuestionDraftsTab = () => {
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(false)
  const [businessLines, setBusinessLines] = useState([])
  const [kbNodeOptions, setKbNodeOptions] = useState([])
  const [kbSearching, setKbSearching] = useState(false)

  const [generateVisible, setGenerateVisible] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generateForm] = Form.useForm()

  const [editingDraft, setEditingDraft] = useState(null)
  const [editForm] = Form.useForm()

  const [approvingDraft, setApprovingDraft] = useState(null)
  const [approveForm] = Form.useForm()
  const [actionLoading, setActionLoading] = useState(null)

  const fetchBusinessLines = async () => {
    try {
      const res = await axios.get(`${API_BASE}/prewarm/status`)
      setBusinessLines(res.data?.business_lines || [])
    } catch (e) { /* 允许手动输入兜底 */ }
  }

  const fetchDrafts = async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/practice-question-drafts`)
      setDrafts(res.data || [])
    } catch (e) {
      message.error('加载题目草稿失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setLoading(false)
    }
  }

  const searchKbNodes = async (value) => {
    setKbSearching(true)
    try {
      const res = await axios.get(`${API_BASE}/kb-nodes/search`, { params: { q: value || '' } })
      setKbNodeOptions((res.data || []).map(n => ({ label: `[${n.business_line || '未分类'}] ${n.content}`, value: n.node_id })))
    } catch (e) {
      // 检索失败静默，不打断草稿生成表单的使用
    } finally {
      setKbSearching(false)
    }
  }

  useEffect(() => { fetchBusinessLines(); fetchDrafts(); searchKbNodes('') }, [])

  const openGenerate = () => {
    generateForm.resetFields()
    generateForm.setFieldsValue({ difficulty: 'medium' })
    setGenerateVisible(true)
  }

  const handleGenerate = async () => {
    try {
      const values = await generateForm.validateFields()
      setGenerating(true)
      await axios.post(`${API_BASE}/practice-question-drafts/generate`, values)
      message.success('已生成草稿，请在下方列表审核')
      setGenerateVisible(false)
      fetchDrafts()
    } catch (e) {
      if (e.response?.data?.detail) message.error('生成失败: ' + e.response.data.detail)
    } finally {
      setGenerating(false)
    }
  }

  const openEdit = (draft) => {
    setEditingDraft(draft)
    editForm.setFieldsValue({
      scenario: draft.scenario,
      reference_answer: draft.reference_answer,
      key_points_text: (draft.key_points || []).join('、'),
      difficulty: draft.difficulty,
    })
  }

  const handleSaveEdit = async () => {
    try {
      const values = await editForm.validateFields()
      await axios.put(`${API_BASE}/practice-question-drafts/${editingDraft.id}`, {
        scenario: values.scenario,
        reference_answer: values.reference_answer,
        key_points: (values.key_points_text || '').split(/[、,，]/).map(k => k.trim()).filter(Boolean),
        difficulty: values.difficulty,
      })
      message.success('草稿已更新')
      setEditingDraft(null)
      fetchDrafts()
    } catch (e) {
      if (e.response?.data?.detail) message.error('保存失败: ' + e.response.data.detail)
    }
  }

  const openApprove = async (draft) => {
    setApprovingDraft(draft)
    let defaultOrder = 0
    try {
      const res = await axios.get(`${API_BASE}/practice-nodes`, { params: { business_line: draft.business_line } })
      defaultOrder = (res.data || []).length
    } catch (e) { /* 拿不到就默认从 0 开始，管理员可手动改 */ }
    approveForm.resetFields()
    approveForm.setFieldsValue({ order_index: defaultOrder })
  }

  const handleApprove = async () => {
    try {
      const values = await approveForm.validateFields()
      setActionLoading(approvingDraft.id)
      await axios.post(`${API_BASE}/practice-question-drafts/${approvingDraft.id}/approve`, values)
      message.success('已写入题目镜像表，记得手动同步到 Coze 工作流编辑器')
      setApprovingDraft(null)
      fetchDrafts()
    } catch (e) {
      if (e.response?.data?.detail) message.error('入库失败: ' + e.response.data.detail)
    } finally {
      setActionLoading(null)
    }
  }

  const handleReject = async (draft) => {
    setActionLoading(draft.id)
    try {
      await axios.post(`${API_BASE}/practice-question-drafts/${draft.id}/reject`)
      message.info('已驳回')
      fetchDrafts()
    } catch (e) {
      message.error('驳回失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setActionLoading(null)
    }
  }

  const statusTag = (status) => {
    if (status === 'approved') return <Tag color="success">已入库</Tag>
    if (status === 'rejected') return <Tag color="default">已驳回</Tag>
    return <Tag color="processing">待审核</Tag>
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Text type="secondary">
          选一个知识库节点，AI 起草一道情景练习题（场景+参考答案+得分点），审核通过后写入题目镜像表。
        </Typography.Text>
        <Space>
          <Button onClick={fetchDrafts} loading={loading}>刷新</Button>
          <Button type="primary" icon={<ThunderboltOutlined />} onClick={openGenerate}>生成草稿</Button>
        </Space>
      </div>
      <Table
        dataSource={drafts}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 8 }}
        columns={[
          { title: '业务线', dataIndex: 'business_line', key: 'business_line', width: 110, render: v => <Tag color="blue">{v}</Tag> },
          { title: '场景（题干）', dataIndex: 'scenario', key: 'scenario', ellipsis: true },
          { title: '得分点', dataIndex: 'key_points', key: 'key_points', width: 180, render: kps => (kps || []).map(k => <Tag key={k}>{k}</Tag>) },
          { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: statusTag },
          {
            title: '操作', key: 'actions', width: 220,
            render: (_, row) => row.status === 'pending' ? (
              <Space size="small">
                <Button size="small" onClick={() => openEdit(row)}>编辑</Button>
                <Button size="small" type="primary" loading={actionLoading === row.id} onClick={() => openApprove(row)}>确认入库</Button>
                <Button size="small" danger loading={actionLoading === row.id} onClick={() => handleReject(row)}>驳回</Button>
              </Space>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {row.status === 'approved' ? '已写入题目镜像表' : '已驳回，不再处理'}
              </Typography.Text>
            )
          },
        ]}
      />

      <Modal title="生成题目草稿" open={generateVisible} onOk={handleGenerate} confirmLoading={generating} onCancel={() => setGenerateVisible(false)} destroyOnClose>
        <Form form={generateForm} layout="vertical">
          <Form.Item name="business_line" label="归属业务线" rules={[{ required: true, message: '请选择或输入业务线' }]}>
            <AutoComplete
              placeholder="选择已有业务线，或直接输入新业务线名称"
              options={businessLines.map(bl => ({ label: bl, value: bl }))}
              filterOption={(input, option) => (option?.value ?? '').includes(input)}
            />
          </Form.Item>
          <Form.Item name="source_node_id" label="知识库节点（出题素材）" rules={[{ required: true, message: '请选择知识库节点' }]}>
            <Select
              showSearch
              placeholder="搜索知识库节点内容"
              loading={kbSearching}
              filterOption={false}
              onSearch={searchKbNodes}
              options={kbNodeOptions}
            />
          </Form.Item>
          <Form.Item name="difficulty" label="难度">
            <Select options={[{ value: 'easy', label: '简单' }, { value: 'medium', label: '中等' }, { value: 'hard', label: '困难' }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="编辑草稿" open={!!editingDraft} onOk={handleSaveEdit} onCancel={() => setEditingDraft(null)} okText="保存" destroyOnClose>
        <Form form={editForm} layout="vertical">
          <Form.Item name="scenario" label="场景（题干）" rules={[{ required: true, message: '请输入题干' }]}>
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="reference_answer" label="参考答案" rules={[{ required: true, message: '请输入参考答案' }]}>
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="key_points_text" label="得分点（用、或,分隔）" rules={[{ required: true, message: '请至少填写一个得分点' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="difficulty" label="难度">
            <Select options={[{ value: 'easy', label: '简单' }, { value: 'medium', label: '中等' }, { value: 'hard', label: '困难' }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="确认入库"
        open={!!approvingDraft}
        onOk={handleApprove}
        confirmLoading={actionLoading === approvingDraft?.id}
        onCancel={() => setApprovingDraft(null)}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          写入题目镜像表后仍需要手动把文案同步到 Coze 工作流编辑器（题目节点管理页可标记同步状态）。
        </Typography.Paragraph>
        <Form form={approveForm} layout="vertical">
          <Form.Item name="node_key" label="节点标识（可选）" tooltip="自行对照 Coze 工作流节点标题填写">
            <Input placeholder="如：挂失受理" />
          </Form.Item>
          <Form.Item name="order_index" label="顺序" rules={[{ required: true, message: '请输入顺序' }]} tooltip="需要和 Coze 工作流里该节点的实际先后顺序一致，打分靠这个对齐">
            <Input type="number" min={0} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default PracticeQuestionDraftsTab
