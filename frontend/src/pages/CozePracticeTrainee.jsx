import React, { useState, useEffect, useRef } from 'react'
import { Typography, Card, Select, Radio, Button, Input, Space, message, Tag, Modal, Descriptions, List, Empty, Alert, Spin } from 'antd'
import { SendOutlined, ReloadOutlined, FlagOutlined } from '@ant-design/icons'
import axios from 'axios'
import { API_V1 } from '../config/api'

const { Title, Paragraph, Text } = Typography
const { TextArea } = Input

const API_BASE = `${API_V1}/coze-practice`

const MODE_OPTIONS = [
  { label: '练习（原题练习，题目固定不变）', value: 'practice' },
  { label: '通关（题目会被适当润色改写，按得分点覆盖率判定过关）', value: 'tongguan' },
]

const CozePracticeTrainee = () => {
  const [businessLines, setBusinessLines] = useState([])
  const [loadingLines, setLoadingLines] = useState(false)
  const [selectedLine, setSelectedLine] = useState(undefined)
  const [mode, setMode] = useState('practice')

  const [session, setSession] = useState(null) // { session_id, business_line, mode, used_fallback }
  const [messages, setMessages] = useState([]) // [{ role: 'assistant'|'trainee', content }]
  const [inputValue, setInputValue] = useState('')
  const [starting, setStarting] = useState(false)
  const [sending, setSending] = useState(false)
  const [ending, setEnding] = useState(false)
  const [result, setResult] = useState(null) // 会话结束后的评分结果
  const listEndRef = useRef(null)

  const fetchBusinessLines = async () => {
    setLoadingLines(true)
    try {
      const res = await axios.get(`${API_BASE}/business-lines`)
      setBusinessLines(res.data?.business_lines || [])
    } catch (e) {
      message.error('加载业务线失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setLoadingLines(false)
    }
  }

  useEffect(() => { fetchBusinessLines() }, [])
  useEffect(() => { listEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const handleStart = async () => {
    if (!selectedLine) {
      message.warning('请先选择业务线')
      return
    }
    setStarting(true)
    setResult(null)
    try {
      const res = await axios.post(`${API_BASE}/workflow/start`, { business_line: selectedLine, mode })
      setSession(res.data)
      setMessages([{ role: 'assistant', content: res.data.question }])
      if (res.data.used_fallback) {
        message.info('当前该业务线未接入 Coze 工作流（或调用失败），已自动切换本地题库继续练习')
      }
    } catch (e) {
      message.error('开始失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setStarting(false)
    }
  }

  const fetchFinalResult = async (sessionId) => {
    try {
      const res = await axios.get(`${API_BASE}/workflow/${sessionId}`)
      setResult(res.data)
    } catch (e) {
      message.error('获取评分结果失败: ' + (e.response?.data?.detail || e.message))
    }
  }

  const handleSend = async () => {
    if (!inputValue.trim() || !session) return
    const answer = inputValue.trim()
    setMessages(prev => [...prev, { role: 'trainee', content: answer }])
    setInputValue('')
    setSending(true)
    try {
      const res = await axios.post(`${API_BASE}/workflow/answer`, { session_id: session.session_id, answer })
      if (res.data.status === 'completed') {
        setMessages(prev => [...prev, { role: 'system', content: '本场练习已结束，正在生成评分报告…' }])
        await fetchFinalResult(session.session_id)
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: res.data.next_question }])
      }
    } catch (e) {
      message.error('提交失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setSending(false)
    }
  }

  const handleEndEarly = async () => {
    if (!session) return
    setEnding(true)
    try {
      const res = await axios.post(`${API_BASE}/workflow/end`, { session_id: session.session_id })
      setResult(res.data)
      message.info('已提前结束本场练习')
    } catch (e) {
      message.error('结束失败: ' + (e.response?.data?.detail || e.message))
    } finally {
      setEnding(false)
    }
  }

  const handleRestart = () => {
    setSession(null)
    setMessages([])
    setResult(null)
    setInputValue('')
  }

  return (
    <div>
      <Title level={3}>情景陪练（业务线工作流）</Title>
      <Paragraph type="secondary">
        按业务线驱动的多轮情景对话陪练，题目内容由后台维护（Coze 工作流或本地兜底题库均可），
        跑完全部题目后按「得分点覆盖率」出评分报告。和「考生端 · 练习中心」是两套不同机制，互不影响。
      </Paragraph>

      {!session && (
        <Card>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Text strong>选择业务线</Text>
              <div style={{ marginTop: 8 }}>
                <Select
                  style={{ width: 320 }}
                  loading={loadingLines}
                  placeholder="选择要练习的业务线"
                  value={selectedLine}
                  onChange={setSelectedLine}
                  options={businessLines.map(bl => ({ label: bl, value: bl }))}
                  notFoundContent={loadingLines ? '加载中...' : '暂无业务线，请联系管理员先完成知识库预热'}
                />
              </div>
            </div>
            <div>
              <Text strong>选择模式</Text>
              <div style={{ marginTop: 8 }}>
                <Radio.Group options={MODE_OPTIONS} onChange={e => setMode(e.target.value)} value={mode} optionType="button" buttonStyle="solid" />
              </div>
            </div>
            <Button type="primary" size="large" loading={starting} onClick={handleStart}>开始</Button>
            {starting && (
              <Alert
                type="info"
                showIcon
                icon={<Spin size="small" />}
                message={
                  mode === 'tongguan'
                    ? '正在生成润色后的场景，通关模式可能需要 10~20 秒，请耐心等待…'
                    : '正在加载题目…'
                }
              />
            )}
          </Space>
        </Card>
      )}

      {session && !result && (
        <Card
          title={<Space><Tag color="blue">{session.business_line}</Tag><Tag color={session.mode === 'tongguan' ? 'volcano' : 'green'}>{session.mode === 'tongguan' ? '通关' : '练习'}</Tag>{session.used_fallback && <Tag>本地兜底</Tag>}</Space>}
          extra={<Button danger icon={<FlagOutlined />} loading={ending} onClick={handleEndEarly}>提前结束</Button>}
        >
          <div style={{ maxHeight: 460, overflowY: 'auto', padding: '8px 4px', marginBottom: 16 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'trainee' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
                <div style={{
                  maxWidth: '75%',
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: m.role === 'trainee' ? '#1d39c4' : m.role === 'system' ? '#fafafa' : '#f0f2f5',
                  color: m.role === 'trainee' ? '#fff' : m.role === 'system' ? '#8c8c8c' : 'rgba(0,0,0,0.88)',
                  fontStyle: m.role === 'system' ? 'italic' : 'normal',
                }}>
                  {m.content}
                </div>
              </div>
            ))}
            <div ref={listEndRef} />
          </div>
          <Space.Compact style={{ width: '100%' }}>
            <TextArea
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="请输入您的回复话术（Enter 发送，Shift+Enter 换行）"
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={sending}
            />
            <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={handleSend}>发送</Button>
          </Space.Compact>
        </Card>
      )}

      {result && (
        <Card
          title="评分报告"
          extra={<Button icon={<ReloadOutlined />} onClick={handleRestart}>再来一次</Button>}
        >
          {result.mode === 'tongguan' && (
            <Alert
              style={{ marginBottom: 16 }}
              type={result.passed == null ? 'info' : result.passed ? 'success' : 'warning'}
              showIcon
              message={
                result.passed == null
                  ? '该业务线暂未配置评分标准（题目节点未录入参考答案/得分点），无法判定通关，以下仅供参考'
                  : result.passed ? '恭喜，本次通关！' : '未达到通关标准，可以再练习一次'
              }
            />
          )}
          <Descriptions bordered column={2} size="small">
            <Descriptions.Item label="业务线">{result.business_line}</Descriptions.Item>
            <Descriptions.Item label="模式">{result.mode === 'tongguan' ? '通关' : '练习'}</Descriptions.Item>
            <Descriptions.Item label="平均得分">{result.overall_score ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="得分点覆盖率">
              {result.coverage_rate != null ? `${Math.round(result.coverage_rate * 100)}%（${result.key_points_hit}/${result.key_points_total}）` : '暂无评分标准'}
            </Descriptions.Item>
          </Descriptions>
          {result.weakness_tags?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Text strong>本场未覆盖的得分点：</Text>
              <div style={{ marginTop: 8 }}>
                {result.weakness_tags.map(t => <Tag color="orange" key={t}>{t}</Tag>)}
              </div>
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <Text strong>对话记录</Text>
            <List
              style={{ marginTop: 8 }}
              size="small"
              bordered
              dataSource={result.transcript || []}
              renderItem={(t) => {
                const missedSet = new Set(t.missed_points || [])
                return (
                  <List.Item>
                    <div style={{ width: '100%' }}>
                      <div><Tag color="blue">问</Tag>{t.question_text}</div>
                      <div style={{ marginTop: 4 }}>
                        <Tag color="green">答</Tag>{t.trainee_answer || <Text type="secondary">（未作答）</Text>}
                        {t.trainee_answer && !t.scored && (
                          <Tag color="default" style={{ marginLeft: 8 }}>
                            {t.score_skip_reason || '未计入评分'}
                          </Tag>
                        )}
                        {t.scored && t.score != null && (
                          <Tag color={t.score >= 80 ? 'success' : t.score >= 60 ? 'warning' : 'error'} style={{ marginLeft: 8 }}>
                            本题得分 {t.score}
                          </Tag>
                        )}
                      </div>
                      {t.key_points && t.key_points.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <Text type="secondary" style={{ marginRight: 6 }}>本题得分点：</Text>
                          {t.key_points.map(kp => (
                            <Tag
                              key={kp}
                              color={!t.scored ? 'default' : missedSet.has(kp) ? 'orange' : 'green'}
                              style={{ marginBottom: 4 }}
                            >
                              {t.scored ? (missedSet.has(kp) ? `✗ ${kp}` : `✓ ${kp}`) : kp}
                            </Tag>
                          ))}
                        </div>
                      )}
                      {t.scored && t.feedback && (
                        <div style={{ marginTop: 4 }}>
                          <Text type="secondary">点评：{t.feedback}</Text>
                        </div>
                      )}
                      {t.reference_answer && (
                        <div style={{ marginTop: 8, padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6 }}>
                          <Text strong style={{ color: '#389e0d' }}>推荐回答：</Text>
                          <Text>{t.reference_answer}</Text>
                        </div>
                      )}
                    </div>
                  </List.Item>
                )
              }}
              locale={{ emptyText: <Empty description="暂无记录" /> }}
            />
          </div>
        </Card>
      )}
    </div>
  )
}

export default CozePracticeTrainee
