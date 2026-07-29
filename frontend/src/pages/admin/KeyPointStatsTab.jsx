import React, { useState, useEffect } from 'react'
import { Typography, Table, Button, Space, Modal, Form, Input, message, Tag, Statistic, Divider } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import axios from 'axios'
import { API_BASE } from './constants'

const { TextArea } = Input

// ===== V5.0: 自适应知识进化引擎 · 阶段一 —— 踩分点命中率统计子组件 =====
const KeyPointStatsTab = () => {
  const [data, setData] = useState({ total_key_points: 0, reliable_count: 0, weakest_points: [], insufficient_sample_points: [] })
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)

  const [drafts, setDrafts] = useState([])
  const [draftsLoading, setDraftsLoading] = useState(false)
  const [editingDraft, setEditingDraft] = useState(null)
  const [draftForm] = Form.useForm()
  const [draftActionLoading, setDraftActionLoading] = useState(null) // draft id currently being approved/rejected

  const fetchStats = async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/key-points/stats`, { params: { min_samples: 3 } })
      setData(res.data)
    } catch (e) {
      message.error('加载踩分点统计失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setLoading(false)
    }
  }

  const fetchDrafts = async () => {
    setDraftsLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/knowledge-drafts`)
      setDrafts(res.data || [])
    } catch (e) {
      message.error('加载知识草稿失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setDraftsLoading(false)
    }
  }

  useEffect(() => {
    fetchStats()
    fetchDrafts()
  }, [])

  const handleScan = async () => {
    setScanning(true)
    try {
      const res = await axios.post(`${API_BASE}/knowledge-drafts/scan`)
      if (res.data.generated > 0) {
        message.success(`成功生成 ${res.data.generated} 条知识草稿：${res.data.generated_points.join('、')}`)
      } else {
        message.info(res.data.message || '暂无符合条件的薄弱知识点')
      }
      if (res.data.failed?.length > 0) {
        message.warning(`${res.data.failed.length} 条起草失败，请稍后重试`)
      }
      fetchDrafts()
    } catch (e) {
      message.error('扫描生成失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setScanning(false)
    }
  }

  const openEditDraft = (draft) => {
    setEditingDraft(draft)
    draftForm.setFieldsValue({
      title: draft.title,
      content: draft.content,
      keywords_text: (draft.keywords || []).join('、')
    })
  }

  const handleSaveDraft = async () => {
    try {
      const values = await draftForm.validateFields()
      await axios.put(`${API_BASE}/knowledge-drafts/${editingDraft.id}`, {
        title: values.title,
        content: values.content,
        keywords: values.keywords_text.split(/[、,，]/).map(k => k.trim()).filter(Boolean)
      })
      message.success('草稿已更新')
      setEditingDraft(null)
      fetchDrafts()
    } catch (e) {
      if (e.response) message.error('保存失败: ' + (e.response?.data?.detail || e.message))
    }
  }

  const handleApprove = async (draft) => {
    setDraftActionLoading(draft.id)
    try {
      await axios.post(`${API_BASE}/knowledge-drafts/${draft.id}/approve`)
      message.success(`已确认入库，知识库新增节点 ${draft.title}`)
      fetchDrafts()
    } catch (e) {
      message.error('入库失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setDraftActionLoading(null)
    }
  }

  const handleReject = async (draft) => {
    setDraftActionLoading(draft.id)
    try {
      await axios.post(`${API_BASE}/knowledge-drafts/${draft.id}/reject`)
      message.info('已驳回')
      fetchDrafts()
    } catch (e) {
      message.error('驳回失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setDraftActionLoading(null)
    }
  }

  const hitRateColor = (rate) => rate >= 70 ? '#52c41a' : rate >= 40 ? '#faad14' : '#f5222d'
  const statusTag = (status) => {
    if (status === 'approved') return <Tag color="success">已入库</Tag>
    if (status === 'rejected') return <Tag color="default">已驳回</Tag>
    return <Tag color="processing">待审核</Tag>
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space size="large">
          <Statistic title="累计踩分点总数" value={data.total_key_points} />
          <Statistic title="有效统计样本（≥3人次）" value={data.reliable_count} />
          <Statistic title="样本不足（暂不纳入排序）" value={data.insufficient_sample_points?.length || 0} />
        </Space>
        <Button onClick={fetchStats} loading={loading}>刷新</Button>
      </div>
      <Typography.Paragraph type="secondary">
        统计全体学员在各业务线踩分点上的命中率，命中率越低排越前，代表这是"大家普遍容易答错"的群体性薄弱知识点，
        可作为知识库补强、培训重点的依据。
      </Typography.Paragraph>
      <Table
        dataSource={data.weakest_points}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: '业务线', dataIndex: 'business_line', key: 'business_line', width: 140, render: v => <Tag color="blue">{v}</Tag> },
          { title: '踩分点', dataIndex: 'point', key: 'point' },
          { title: '关键词', dataIndex: 'keywords', key: 'keywords', render: kws => (kws || []).slice(0, 4).map(k => <Tag key={k}>{k}</Tag>) },
          {
            title: '命中率', dataIndex: 'hit_rate', key: 'hit_rate', width: 200,
            render: (rate, row) => (
              <span>
                <span style={{ color: hitRateColor(rate), fontWeight: 700 }}>{rate}%</span>
                <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  （{row.hit_count} / {row.total_count} 人次）
                </Typography.Text>
              </span>
            )
          },
          { title: '权重', dataIndex: 'weight', key: 'weight', width: 80 },
        ]}
      />

      <Divider />

      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          <ThunderboltOutlined /> 待审核知识草稿
        </Typography.Title>
        <Space>
          <Button onClick={fetchDrafts} loading={draftsLoading}>刷新</Button>
          <Button type="primary" icon={<ThunderboltOutlined />} loading={scanning} onClick={handleScan}>
            扫描并生成知识草稿
          </Button>
        </Space>
      </div>
      <Typography.Paragraph type="secondary">
        点击"扫描并生成知识草稿"，系统会自动找出命中率低于 40%、且样本量足够（≥5人次）、还没起草过的薄弱踩分点，
        调用 AI 起草补充知识内容。生成的草稿需要你确认后才会真正写入知识库。
      </Typography.Paragraph>
      <Table
        dataSource={drafts}
        rowKey="id"
        loading={draftsLoading}
        pagination={{ pageSize: 5 }}
        columns={[
          { title: '标题', dataIndex: 'title', key: 'title', width: 200 },
          {
            title: '来源', key: 'source', width: 220,
            render: (_, row) => (
              <span style={{ fontSize: 12 }}>
                <Tag color="blue">{row.business_line}</Tag>{row.source_point}
                <br />
                <Typography.Text type="secondary">命中率 {row.source_hit_rate}%</Typography.Text>
              </span>
            )
          },
          { title: '正文预览', dataIndex: 'content', key: 'content', render: v => <span style={{ fontSize: 12 }}>{(v || '').slice(0, 60)}...</span> },
          { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: statusTag },
          {
            title: '操作', key: 'actions', width: 200,
            render: (_, row) => row.status === 'pending' ? (
              <Space size="small">
                <Button size="small" onClick={() => openEditDraft(row)}>编辑</Button>
                <Button size="small" type="primary" loading={draftActionLoading === row.id} onClick={() => handleApprove(row)}>确认入库</Button>
                <Button size="small" danger loading={draftActionLoading === row.id} onClick={() => handleReject(row)}>驳回</Button>
              </Space>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {row.status === 'approved' ? `已生成节点 ${row.node_id}` : '已驳回，不再处理'}
              </Typography.Text>
            )
          },
        ]}
      />

      <Modal
        title="编辑知识草稿"
        open={!!editingDraft}
        onOk={handleSaveDraft}
        onCancel={() => setEditingDraft(null)}
        okText="保存"
      >
        <Form form={draftForm} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="content" label="正文" rules={[{ required: true, message: '请输入正文' }]}>
            <TextArea rows={6} />
          </Form.Item>
          <Form.Item name="keywords_text" label="关键词（用、或,分隔）">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default KeyPointStatsTab
