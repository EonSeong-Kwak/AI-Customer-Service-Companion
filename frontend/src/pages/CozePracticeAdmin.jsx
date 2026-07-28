import React, { useState, useEffect } from 'react'
import { Typography, Card, Tabs, Table, Button, Space, Modal, Form, Input, InputNumber, Select, Switch, message, Popconfirm, Tag } from 'antd'
import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import axios from 'axios'

const { Title, Paragraph } = Typography
const { TextArea } = Input

const API_BASE = 'http://localhost:8000/api/v1/coze-practice-admin'
const ADMIN_API_BASE = 'http://localhost:8000/api/v1/admin'

// ========== 1. 业务线 ↔ Coze 工作流 注册表 ==========
const WorkflowRegistryTab = () => {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(false)
  const [businessLines, setBusinessLines] = useState([])
  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()

  const fetchList = async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/coze-workflows`)
      setList(res.data || [])
    } catch (e) {
      message.error('加载工作流注册表失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setLoading(false)
    }
  }

  const fetchBusinessLines = async () => {
    try {
      const res = await axios.get(`${ADMIN_API_BASE}/prewarm/status`)
      setBusinessLines(res.data?.business_lines || [])
    } catch (e) { /* 拿不到真实业务线列表时不报错打扰，下拉框允许手动输入兜底 */ }
  }

  useEffect(() => { fetchList(); fetchBusinessLines() }, [])

  const openModal = (record = null) => {
    setEditing(record)
    if (record) {
      form.setFieldsValue(record)
    } else {
      form.resetFields()
      form.setFieldsValue({ mode_param_key: 'mode', practice_mode_value: 'practice', tongguan_mode_value: 'tongguan', enabled: true })
    }
    setModalVisible(true)
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    try {
      if (editing) {
        await axios.put(`${API_BASE}/coze-workflows/${editing.id}`, values)
      } else {
        await axios.post(`${API_BASE}/coze-workflows`, values)
      }
      message.success('已保存')
      setModalVisible(false)
      fetchList()
    } catch (e) {
      message.error('保存失败: ' + (e.response?.data?.detail || e.message))
    }
  }

  const handleDelete = async (id) => {
    try {
      await axios.delete(`${API_BASE}/coze-workflows/${id}`)
      message.success('已删除')
      fetchList()
    } catch (e) {
      message.error('删除失败: ' + (e.response?.data?.detail || e.message))
    }
  }

  return (
    <div>
      <Paragraph type="secondary">
        每个业务线对应一条 Coze 工作流。登记之后，考生端选这个业务线开始练习/通关时，
        后端会去调用这里配置的 workflow_id；未登记或调用失败时，自动降级为本地兜底题库，不会导致考生无法练习。
      </Paragraph>
      <div style={{ marginBottom: 16, textAlign: 'right' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>新增业务线工作流</Button>
      </div>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={list}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: '业务线', dataIndex: 'business_line', width: 140, render: v => <Tag color="blue">{v}</Tag> },
          { title: 'workflow_id', dataIndex: 'workflow_id', width: 200, ellipsis: true },
          { title: '模式参数', key: 'mode', width: 240, render: (_, r) => <span style={{ fontSize: 12 }}>{r.mode_param_key} = {r.practice_mode_value} / {r.tongguan_mode_value}</span> },
          { title: '启用', dataIndex: 'enabled', width: 70, render: v => v ? <Tag color="success">是</Tag> : <Tag>否</Tag> },
          { title: '备注', dataIndex: 'notes', ellipsis: true },
          {
            title: '操作', key: 'actions', width: 140,
            render: (_, r) => (
              <Space size="small">
                <Button size="small" onClick={() => openModal(r)}>编辑</Button>
                <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            )
          }
        ]}
      />
      <Modal title={editing ? '编辑工作流注册' : '新增业务线工作流'} open={modalVisible} onOk={handleSave} onCancel={() => setModalVisible(false)} destroyOnClose width={600}>
        <Form form={form} layout="vertical">
          <Form.Item name="business_line" label="业务线" rules={[{ required: true, message: '请选择业务线' }]}>
            <Select
              disabled={!!editing}
              showSearch
              allowClear
              placeholder="选择系统已识别的业务线"
              options={businessLines.map(bl => ({ label: bl, value: bl }))}
              filterOption={(input, option) => (option?.label ?? '').includes(input)}
              notFoundContent="暂无数据，可先在「练习题库」的知识库预热里刷新业务线"
            />
          </Form.Item>
          <Form.Item name="workflow_id" label="Coze 工作流 ID" rules={[{ required: true, message: '请输入 workflow_id' }]}>
            <Input placeholder="在 Coze 工作流发布页可以拿到" />
          </Form.Item>
          <Form.Item name="bot_id" label="bot_id（可选，覆盖全局默认）">
            <Input />
          </Form.Item>
          <Form.Item name="app_id" label="app_id（可选，与 bot_id 二选一）">
            <Input />
          </Form.Item>
          <Form.Item name="mode_param_key" label="传给工作流「分类」节点的参数名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="practice_mode_value" label="练习模式对应的参数值" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="tongguan_mode_value" label="通关模式对应的参数值" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

// ========== 2. 练习节点题目镜像表 ==========
const PracticeNodesTab = () => {
  const [businessLines, setBusinessLines] = useState([])
  const [filterLine, setFilterLine] = useState(undefined)
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()
  const [kbNodeOptions, setKbNodeOptions] = useState([])
  const [kbSearching, setKbSearching] = useState(false)

  const fetchBusinessLines = async () => {
    try {
      const res = await axios.get(`${ADMIN_API_BASE}/prewarm/status`)
      setBusinessLines(res.data?.business_lines || [])
    } catch (e) { /* 静默 */ }
  }

  const fetchNodes = async (line) => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/practice-nodes`, { params: line ? { business_line: line } : {} })
      setNodes(res.data || [])
    } catch (e) {
      message.error('加载题目节点失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchBusinessLines(); fetchNodes() }, [])

  const handleSearchKbNodes = async (value) => {
    if (!value) return
    setKbSearching(true)
    try {
      const res = await axios.get(`${ADMIN_API_BASE}/kb-nodes/search`, { params: { q: value } })
      setKbNodeOptions(res.data.map(n => ({ label: `[${n.business_line || '未分类'}] ${n.content.substring(0, 50)}...`, value: n.node_id })))
    } catch (e) { /* 静默 */ } finally { setKbSearching(false) }
  }

  const openModal = (record = null) => {
    setEditing(record)
    if (record) {
      form.setFieldsValue({ ...record, key_points: (record.key_points || []).join('，') })
    } else {
      form.resetFields()
      form.setFieldsValue({ order_index: 0, difficulty: 'medium', business_line: filterLine })
    }
    setModalVisible(true)
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    const payload = { ...values, key_points: values.key_points ? values.key_points.split('，').map(k => k.trim()).filter(Boolean) : [] }
    try {
      if (editing) {
        await axios.put(`${API_BASE}/practice-nodes/${editing.id}`, payload)
      } else {
        await axios.post(`${API_BASE}/practice-nodes`, payload)
      }
      message.success('已保存')
      setModalVisible(false)
      fetchNodes(filterLine)
    } catch (e) {
      message.error('保存失败: ' + (e.response?.data?.detail || e.message))
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
      message.success('已标记为「已同步」')
      fetchNodes(filterLine)
    } catch (e) {
      message.error('操作失败: ' + (e.response?.data?.detail || e.message))
    }
  }

  return (
    <div>
      <Paragraph type="secondary">
        这里维护的文案是"应该在 Coze 工作流节点里长什么样"的标准版本——既是本地兜底/打分依据，
        也是你手动去 Coze 控制台粘贴时的定稿来源（Coze 工作流节点内容没有 API 能直接改）。
        改完文案记得手动同步到 Coze，再回来点「标记已同步」。
      </Paragraph>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Select
          allowClear
          style={{ width: 240 }}
          placeholder="按业务线筛选"
          options={businessLines.map(bl => ({ label: bl, value: bl }))}
          value={filterLine}
          onChange={(v) => { setFilterLine(v); fetchNodes(v) }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>新增题目节点</Button>
      </div>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={nodes}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: '业务线', dataIndex: 'business_line', width: 110, render: v => <Tag color="blue">{v}</Tag> },
          { title: '顺序', dataIndex: 'order_index', width: 60 },
          { title: '节点标识', dataIndex: 'node_key', width: 140 },
          { title: '题目文案', dataIndex: 'question_text', ellipsis: true },
          { title: '得分点', dataIndex: 'key_points', width: 200, render: kps => (kps || []).slice(0, 3).map(k => <Tag key={k}>{k}</Tag>) },
          { title: '同步状态', dataIndex: 'sync_status', width: 90, render: v => v === 'synced' ? <Tag color="success">已同步</Tag> : <Tag color="warning">未同步</Tag> },
          {
            title: '操作', key: 'actions', width: 220,
            render: (_, r) => (
              <Space size="small">
                <Button size="small" onClick={() => openModal(r)}>编辑</Button>
                {r.sync_status !== 'synced' && <Button size="small" onClick={() => handleMarkSynced(r.id)}>标记已同步</Button>}
                <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            )
          }
        ]}
      />
      <Modal title={editing ? '编辑题目节点' : '新增题目节点'} open={modalVisible} onOk={handleSave} onCancel={() => setModalVisible(false)} destroyOnClose width={700}>
        <Form form={form} layout="vertical">
          <Form.Item name="business_line" label="业务线" rules={[{ required: true, message: '请选择业务线' }]}>
            <Select
              disabled={!!editing}
              showSearch
              options={businessLines.map(bl => ({ label: bl, value: bl }))}
              filterOption={(input, option) => (option?.label ?? '').includes(input)}
            />
          </Form.Item>
          <Form.Item name="node_key" label="节点标识（对照 Coze 工作流里的节点名，方便你自己核对）">
            <Input placeholder="例如：询问用户信息" />
          </Form.Item>
          <Form.Item name="order_index" label="顺序（决定打分时和考生这一轮问答的对齐位置）" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="source_node_id" label="关联知识库节点（可选，出题素材来源）">
            <Select
              showSearch
              allowClear
              placeholder="输入关键词搜索知识库节点"
              filterOption={false}
              onSearch={handleSearchKbNodes}
              options={kbNodeOptions}
              notFoundContent={kbSearching ? '搜索中...' : '输入关键词搜索'}
            />
          </Form.Item>
          <Form.Item name="question_text" label="练习模式下的固定提问原文" rules={[{ required: true }]}>
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="reference_answer" label="参考答案" rules={[{ required: true }]}>
            <TextArea rows={4} />
          </Form.Item>
          <Form.Item name="key_points" label="得分点（以中文逗号分隔）">
            <Input placeholder="例如：核实身份，说明挂失即时生效，告知费用" />
          </Form.Item>
          <Form.Item name="difficulty" label="难度">
            <Input placeholder="easy / medium / hard" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

// ========== 3. AI 起草练习题草稿 → 审核 ==========
const PracticeDraftsTab = () => {
  const [businessLines, setBusinessLines] = useState([])
  const [drafts, setDrafts] = useState([])
  const [draftsLoading, setDraftsLoading] = useState(false)

  const [genModalVisible, setGenModalVisible] = useState(false)
  const [genForm] = Form.useForm()
  const [generating, setGenerating] = useState(false)
  const [kbNodeOptions, setKbNodeOptions] = useState([])
  const [kbSearching, setKbSearching] = useState(false)

  const [editingDraft, setEditingDraft] = useState(null)
  const [draftForm] = Form.useForm()

  const [approvingDraft, setApprovingDraft] = useState(null)
  const [approveForm] = Form.useForm()

  const [draftActionLoading, setDraftActionLoading] = useState(null)

  const fetchBusinessLines = async () => {
    try {
      const res = await axios.get(`${ADMIN_API_BASE}/prewarm/status`)
      setBusinessLines(res.data?.business_lines || [])
    } catch (e) { /* 静默 */ }
  }

  const fetchDrafts = async () => {
    setDraftsLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/practice-question-drafts`)
      setDrafts(res.data || [])
    } catch (e) {
      message.error('加载草稿失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setDraftsLoading(false)
    }
  }

  useEffect(() => { fetchBusinessLines(); fetchDrafts() }, [])

  const handleSearchKbNodes = async (value) => {
    if (!value) return
    setKbSearching(true)
    try {
      const res = await axios.get(`${ADMIN_API_BASE}/kb-nodes/search`, { params: { q: value } })
      setKbNodeOptions(res.data.map(n => ({ label: `[${n.business_line || '未分类'}] ${n.content.substring(0, 50)}...`, value: n.node_id })))
    } catch (e) { /* 静默 */ } finally { setKbSearching(false) }
  }

  const handleGenerate = async () => {
    const values = await genForm.validateFields()
    setGenerating(true)
    try {
      await axios.post(`${API_BASE}/practice-question-drafts/generate`, values)
      message.success('已生成草稿，待审核')
      setGenModalVisible(false)
      genForm.resetFields()
      fetchDrafts()
    } catch (e) {
      message.error('起草失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setGenerating(false)
    }
  }

  const openEditDraft = (draft) => {
    setEditingDraft(draft)
    draftForm.setFieldsValue({
      scenario: draft.scenario,
      reference_answer: draft.reference_answer,
      key_points: (draft.key_points || []).join('，'),
      difficulty: draft.difficulty,
    })
  }

  const handleSaveDraft = async () => {
    const values = await draftForm.validateFields()
    try {
      await axios.put(`${API_BASE}/practice-question-drafts/${editingDraft.id}`, {
        ...values,
        key_points: values.key_points ? values.key_points.split('，').map(k => k.trim()).filter(Boolean) : [],
      })
      message.success('已更新')
      setEditingDraft(null)
      fetchDrafts()
    } catch (e) {
      message.error('保存失败: ' + (e.response?.data?.detail || e.message))
    }
  }

  const openApprove = (draft) => {
    setApprovingDraft(draft)
    approveForm.setFieldsValue({ node_key: undefined, order_index: 0 })
  }

  const handleApprove = async () => {
    const values = await approveForm.validateFields()
    setDraftActionLoading(approvingDraft.id)
    try {
      await axios.post(`${API_BASE}/practice-question-drafts/${approvingDraft.id}/approve`, values)
      message.success('已定稿，写入题目节点表（记得手动同步进 Coze）')
      setApprovingDraft(null)
      fetchDrafts()
    } catch (e) {
      message.error('操作失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setDraftActionLoading(null)
    }
  }

  const handleReject = async (draft) => {
    setDraftActionLoading(draft.id)
    try {
      await axios.post(`${API_BASE}/practice-question-drafts/${draft.id}/reject`)
      message.info('已驳回')
      fetchDrafts()
    } catch (e) {
      message.error('驳回失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setDraftActionLoading(null)
    }
  }

  const statusTag = (status) => {
    if (status === 'approved') return <Tag color="success">已定稿</Tag>
    if (status === 'rejected') return <Tag color="default">已驳回</Tag>
    return <Tag color="processing">待审核</Tag>
  }

  return (
    <div>
      <Paragraph type="secondary">
        选一个知识库节点，AI 起草一版练习题；你审核确认（可编辑）后才会正式写进题目节点表。
        没有自动扫描触发信号（不像知识草稿那套有命中率阈值），需要你手动挑节点来生成。
      </Paragraph>
      <div style={{ marginBottom: 16, textAlign: 'right' }}>
        <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => setGenModalVisible(true)}>生成练习题草稿</Button>
      </div>
      <Table
        rowKey="id"
        loading={draftsLoading}
        dataSource={drafts}
        pagination={{ pageSize: 8 }}
        columns={[
          { title: '业务线', dataIndex: 'business_line', width: 110, render: v => <Tag color="blue">{v}</Tag> },
          { title: '题目文案', dataIndex: 'scenario', ellipsis: true },
          { title: '得分点', dataIndex: 'key_points', width: 180, render: kps => (kps || []).slice(0, 3).map(k => <Tag key={k}>{k}</Tag>) },
          { title: '状态', dataIndex: 'status', width: 90, render: statusTag },
          {
            title: '操作', key: 'actions', width: 220,
            render: (_, row) => row.status === 'pending' ? (
              <Space size="small">
                <Button size="small" onClick={() => openEditDraft(row)}>编辑</Button>
                <Button size="small" type="primary" loading={draftActionLoading === row.id} onClick={() => openApprove(row)}>确认定稿</Button>
                <Button size="small" danger loading={draftActionLoading === row.id} onClick={() => handleReject(row)}>驳回</Button>
              </Space>
            ) : <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.status === 'approved' ? '已写入题目节点表' : '已驳回，不再处理'}</Typography.Text>
          }
        ]}
      />

      <Modal title="生成练习题草稿" open={genModalVisible} onOk={handleGenerate} confirmLoading={generating} onCancel={() => setGenModalVisible(false)} destroyOnClose>
        <Form form={genForm} layout="vertical" initialValues={{ difficulty: 'medium' }}>
          <Form.Item name="business_line" label="业务线" rules={[{ required: true }]}>
            <Select showSearch options={businessLines.map(bl => ({ label: bl, value: bl }))} filterOption={(input, option) => (option?.label ?? '').includes(input)} />
          </Form.Item>
          <Form.Item name="node_id" label="知识库节点（出题素材）" rules={[{ required: true, message: '请选择一个知识库节点' }]}>
            <Select
              showSearch
              placeholder="输入关键词搜索知识库节点"
              filterOption={false}
              onSearch={handleSearchKbNodes}
              options={kbNodeOptions}
              notFoundContent={kbSearching ? '搜索中...' : '输入关键词搜索'}
            />
          </Form.Item>
          <Form.Item name="difficulty" label="难度">
            <Input placeholder="easy / medium / hard" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="编辑草稿" open={!!editingDraft} onOk={handleSaveDraft} onCancel={() => setEditingDraft(null)} destroyOnClose>
        <Form form={draftForm} layout="vertical">
          <Form.Item name="scenario" label="题目文案" rules={[{ required: true }]}>
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item name="reference_answer" label="参考答案" rules={[{ required: true }]}>
            <TextArea rows={4} />
          </Form.Item>
          <Form.Item name="key_points" label="得分点（以中文逗号分隔）">
            <Input />
          </Form.Item>
          <Form.Item name="difficulty" label="难度">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="确认定稿" open={!!approvingDraft} onOk={handleApprove} confirmLoading={draftActionLoading === approvingDraft?.id} onCancel={() => setApprovingDraft(null)} destroyOnClose>
        <Paragraph type="secondary">定稿后会写入「题目节点」表，还需要在那边手动同步文案进 Coze。</Paragraph>
        <Form form={approveForm} layout="vertical">
          <Form.Item name="node_key" label="节点标识（对照 Coze 工作流节点名，可选）">
            <Input placeholder="例如：询问用户信息" />
          </Form.Item>
          <Form.Item name="order_index" label="顺序" rules={[{ required: true }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

const CozePracticeAdmin = () => {
  return (
    <div>
      <Title level={3}>Coze 工作流练习/通关 管理</Title>
      <Paragraph type="secondary">
        题目内容最终固定在 Coze 工作流节点里（没有可编辑的开放 API），这个页面负责三件事：
        登记业务线对应的工作流、维护/起草题目文案供你手动同步进 Coze、以及本地兜底题库
        （Coze 不可用或未注册时自动接管，保证考生练习不中断）。这是独立新增的模块，不影响原有「练习」功能。
      </Paragraph>
      <Card>
        <Tabs
          defaultActiveKey="registry"
          items={[
            { key: 'registry', label: '业务线 ↔ 工作流', children: <WorkflowRegistryTab /> },
            { key: 'nodes', label: '题目节点', children: <PracticeNodesTab /> },
            { key: 'drafts', label: 'AI 起草审核', children: <PracticeDraftsTab /> },
          ]}
        />
      </Card>
    </div>
  )
}

export default CozePracticeAdmin
