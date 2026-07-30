import React, { useState, useEffect, useRef } from 'react'
import { Card, Typography, Button, Space, Tag, Empty, Spin, App, Tabs, Input, Divider, Alert, Progress, List, Modal, Result, Row, Col, Statistic } from 'antd'
import {
  BookOutlined, ThunderboltOutlined, BulbOutlined, CheckCircleOutlined,
  CloseCircleOutlined, RightOutlined, SendOutlined, HistoryOutlined,
  WarningOutlined, RiseOutlined, FireOutlined, ReloadOutlined,
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import api from '../config/request'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input

const WrongNotebook = () => {
  const { message } = App.useApp()
  const [activeTab, setActiveTab] = useState('weaknesses')
  const [loading, setLoading] = useState(false)
  const [weaknessGroups, setWeaknessGroups] = useState([])
  const [totalWeak, setTotalWeak] = useState(0)
  const [resolvedCount, setResolvedCount] = useState(0)

  const [reverseModalVisible, setReverseModalVisible] = useState(false)
  const [reverseLoading, setReverseLoading] = useState(false)
  const [currentReverse, setCurrentReverse] = useState(null)
  const [reverseAnswer, setReverseAnswer] = useState('')
  const [reverseResult, setReverseResult] = useState(null)
  const [reverseSubmitting, setReverseSubmitting] = useState(false)
  const [chatHistory, setChatHistory] = useState([])

  const [feynmanTopic, setFeynmanTopic] = useState('')
  const [feynmanParaphrase, setFeynmanParaphrase] = useState('')
  const [feynmanResult, setFeynmanResult] = useState(null)
  const [feynmanSubmitting, setFeynmanSubmitting] = useState(false)
  const [feynmanHistory, setFeynmanHistory] = useState([])
  const chatEndRef = useRef(null)

  useEffect(() => { loadWeaknesses() }, [])

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory, feynmanHistory])

  const loadWeaknesses = async () => {
    setLoading(true)
    try {
      const res = await api.get('/practice/weaknesses')
      setWeaknessGroups(res.data)
      const total = res.data.reduce((sum, g) => sum + g.weaknesses.length, 0)
      setTotalWeak(total)
    } catch (err) {
      message.error('加载错题本失败')
    } finally {
      setLoading(false)
    }
  }

  const startReverseTraining = async (group, weak) => {
    setReverseLoading(true)
    try {
      const res = await api.post('/practice/reverse-training', {
        category: group.category,
        weak_points: weak.weak_points,
      })
      setCurrentReverse({
        ...res.data.question,
        category: group.category,
        weak_points: weak.weak_points,
        question_id: res.data.question_id,
        weakness_id: weak.id,
      })
      setReverseAnswer('')
      setReverseResult(null)
      setChatHistory([
        { role: 'system', content: '针对薄弱知识点的反向训练题已生成，请认真作答：' },
        { role: 'question', content: res.data.question.scenario },
      ])
      setReverseModalVisible(true)
    } catch (err) {
      message.error('生成反向训练题失败: ' + (err.response?.data?.detail || err.message))
    } finally {
      setReverseLoading(false)
    }
  }

  const submitReverseAnswer = async () => {
    if (!reverseAnswer.trim()) {
      message.warning('请输入你的回答')
      return
    }
    setReverseSubmitting(true)
    setChatHistory(prev => [...prev, { role: 'user', content: reverseAnswer }])
    try {
      const res = await api.post('/practice/verify-correction', {
        question_id: currentReverse.question_id,
        trainee_answer: reverseAnswer,
        weakness_id: currentReverse.weakness_id,
      })
      setReverseResult(res.data)
      setChatHistory(prev => [...prev, {
        role: 'ai',
        content: res.data.feedback || res.data.analysis || '已完成评估',
        score: res.data.score,
        corrected: res.data.status === 'corrected' || res.data.weakness_resolved,
      }])
      if (res.data.weakness_resolved) {
        message.success('🎉 恭喜！该薄弱知识点已修正')
      }
      loadWeaknesses()
    } catch (err) {
      message.error('提交失败')
    } finally {
      setReverseSubmitting(false)
    }
  }

  const submitFeynman = async () => {
    if (!feynmanTopic.trim() || !feynmanParaphrase.trim()) {
      message.warning('请填写主题和复述内容')
      return
    }
    setFeynmanSubmitting(true)
    setFeynmanHistory(prev => [...prev, { role: 'user', topic: feynmanTopic, content: feynmanParaphrase }])
    try {
      const res = await api.post('/feynman/submit', {
        topic: feynmanTopic,
        paraphrase: feynmanParaphrase,
      })
      setFeynmanResult(res.data)
      setFeynmanHistory(prev => [...prev, { role: 'ai', ...res.data }])
      setFeynmanTopic('')
      setFeynmanParaphrase('')
    } catch (err) {
      message.error('费曼评估失败')
    } finally {
      setFeynmanSubmitting(false)
    }
  }

  const scoreColor = (s) => s >= 80 ? '#52c41a' : s >= 60 ? '#faad14' : '#ff4d4f'

  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, #fa8c16 0%, #d4380d 100%)',
        borderRadius: 16, padding: '24px 28px', marginBottom: 20, color: '#fff',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', right: -10, top: -20, fontSize: 100, opacity: 0.08 }}><BookOutlined /></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 1 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>错题本</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>查漏补缺，针对性攻克薄弱知识点 · 费曼学习法深度巩固</div>
          </div>
          <Row gutter={24}>
            <Col>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700 }}>{totalWeak}</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>待攻克薄弱点</div>
              </div>
            </Col>
            <Col>
              <Button
                icon={<ReloadOutlined />}
                onClick={loadWeaknesses}
                style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', borderRadius: 8 }}
              >
                刷新
              </Button>
            </Col>
          </Row>
        </div>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        size="large"
        items={[
          {
            key: 'weaknesses',
            label: <span><WarningOutlined /> 薄弱知识点</span>,
            children: (
              <Spin spinning={loading}>
                {totalWeak === 0 && !loading ? (
                  <Card style={{ borderRadius: 12, textAlign: 'center', padding: '40px 0' }}>
                    <Result
                      icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                      title="太棒了！暂无薄弱知识点"
                      subTitle="继续保持，去模拟考试或练习中心挑战更多题目吧"
                      extra={<Button type="primary" size="large" onClick={() => window.location.href = '/dynamic-exam'} icon={<ThunderboltOutlined />}>去挑战</Button>}
                    />
                  </Card>
                ) : (
                  weaknessGroups.map((group, gi) => {
                    const colors = ['#ff4d4f', '#fa8c16', '#722ed1', '#13c2c2', '#1677ff']
                    const c = colors[gi % colors.length]
                    return (
                      <Card
                        key={group.category}
                        style={{ borderRadius: 12, marginBottom: 16, borderLeft: `4px solid ${c}` }}
                        title={
                          <Space>
                            <Tag color={c} style={{ borderRadius: 6, fontSize: 13, padding: '2px 10px' }}>{group.category}</Tag>
                            <Text type="secondary" style={{ fontSize: 13 }}>{group.weaknesses.length} 个薄弱点</Text>
                          </Space>
                        }
                      >
                        <List
                          dataSource={group.weaknesses}
                          renderItem={(w, wi) => (
                            <List.Item
                              key={w.id}
                              style={{ padding: '12px 0', borderBottom: wi < group.weaknesses.length - 1 ? '1px solid #f0f0f0' : 'none' }}
                            >
                              <div style={{ width: '100%' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                  <Space size={[6, 6]} wrap>
                                    {w.weak_points?.map((p, pi) => (
                                      <Tag key={pi} color="red" style={{ borderRadius: 4, margin: 0 }}>{p}</Tag>
                                    ))}
                                  </Space>
                                  <Space>
                                    {w.score !== undefined && (
                                      <Tag color={scoreColor(w.score)} style={{ borderRadius: 4 }}>上次得分: {w.score}</Tag>
                                    )}
                                    <Tag color="default" style={{ borderRadius: 4 }}>
                                      {w.source_type === 'exam' ? '动态考试' : w.source_type === 'practice' ? '练习' : '测试'}
                                    </Tag>
                                  </Space>
                                </div>
                                <Button
                                  type="primary"
                                  size="small"
                                  icon={<ThunderboltOutlined />}
                                  loading={reverseLoading}
                                  onClick={() => startReverseTraining(group, w)}
                                  style={{ borderRadius: 6, background: c, boxShadow: 'none' }}
                                >
                                  生成错题变种训练
                                </Button>
                              </div>
                            </List.Item>
                          )}
                        />
                      </Card>
                    )
                  })
                )}
              </Spin>
            ),
          },
          {
            key: 'feynman',
            label: <span><BulbOutlined /> 费曼学习法</span>,
            children: (
              <div>
                <Alert
                  message="费曼学习法：用最简单的话把知识点讲清楚"
                  description="选择一个你想巩固的知识点，用自己的话向AI解释，AI会像小白一样提问，帮你发现理解盲区。能讲明白才是真学会。"
                  type="info"
                  showIcon
                  icon={<BulbOutlined />}
                  style={{ borderRadius: 10, marginBottom: 16 }}
                />
                <Row gutter={16}>
                  <Col xs={24} lg={14}>
                    <Card
                      title={<Space><FireOutlined style={{ color: '#fa541c' }} /> 费曼对话</Space>}
                      style={{ borderRadius: 12, minHeight: 400 }}
                      styles={{ body: { padding: '16px 20px', height: 400, display: 'flex', flexDirection: 'column' } }}
                    >
                      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
                        {feynmanHistory.length === 0 && (
                          <div style={{ textAlign: 'center', paddingTop: 80, color: '#bfbfbf' }}>
                            <BulbOutlined style={{ fontSize: 48, marginBottom: 12 }} />
                            <div>在右侧填写知识点和你的解释，开始费曼学习</div>
                          </div>
                        )}
                        {feynmanHistory.map((h, i) => (
                          <div key={i} style={{ marginBottom: 16 }}>
                            {h.role === 'user' ? (
                              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <div style={{
                                  maxWidth: '80%', background: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
                                  color: '#fff', borderRadius: '12px 12px 2px 12px', padding: '10px 14px',
                                }}>
                                  <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>我的解释 · {h.topic}</div>
                                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{h.content}</div>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: 8 }}>
                                <div style={{
                                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                                  background: 'linear-gradient(135deg, #fa8c16, #d4380d)',
                                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                  <BulbOutlined />
                                </div>
                                <div style={{ maxWidth: '80%' }}>
                                  {h.understanding_score !== undefined && (
                                    <Space style={{ marginBottom: 6 }}>
                                      <Tag color={scoreColor(h.understanding_score)} style={{ borderRadius: 4 }}>
                                        理解度: {h.understanding_score}分
                                      </Tag>
                                      {h.is_accurate ? <Tag color="success" icon={<CheckCircleOutlined />}>核心准确</Tag> : <Tag color="error">存在偏差</Tag>}
                                    </Space>
                                  )}
                                  <div style={{
                                    background: '#fff7e6', border: '1px solid #ffd591', borderRadius: '2px 12px 12px 12px',
                                    padding: '10px 14px', fontSize: 14, lineHeight: 1.7,
                                  }}>
                                    {h.review_suggestion && <div style={{ marginBottom: 8, color: '#d46b08' }}>💡 {h.review_suggestion}</div>}
                                    {h.missing_points?.length > 0 && (
                                      <div>
                                        <Text strong style={{ fontSize: 12 }}>遗漏的关键点：</Text>
                                        <div style={{ marginTop: 4 }}>
                                          {h.missing_points.map((p, pi) => (
                                            <Tag key={pi} color="orange" style={{ margin: '2px 4px 2px 0', borderRadius: 4 }}>{p}</Tag>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                        <div ref={chatEndRef} />
                      </div>
                      <Divider style={{ margin: '8px 0' }} />
                      <Space orientation="vertical" style={{ width: '100%' }} size={8}>
                        <Input
                          placeholder="知识点主题（如：银行卡挂失流程、信用卡还款规则）"
                          prefix={<BookOutlined style={{ color: '#bfbfbf' }} />}
                          value={feynmanTopic}
                          onChange={e => setFeynmanTopic(e.target.value)}
                          size="large"
                          style={{ borderRadius: 8 }}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <TextArea
                            placeholder="用你自己的话解释这个知识点，就像教一个完全不懂的人..."
                            value={feynmanParaphrase}
                            onChange={e => setFeynmanParaphrase(e.target.value)}
                            rows={2}
                            style={{ borderRadius: 8, flex: 1, resize: 'none' }}
                          />
                          <Button
                            type="primary"
                            icon={<SendOutlined />}
                            loading={feynmanSubmitting}
                            onClick={submitFeynman}
                            size="large"
                            style={{ borderRadius: 8, height: 'auto', background: 'linear-gradient(135deg, #fa8c16, #d4380d)', boxShadow: 'none' }}
                          >
                            提交
                          </Button>
                        </div>
                      </Space>
                    </Card>
                  </Col>
                  <Col xs={24} lg={10}>
                    <Card
                      title={<Space><RiseOutlined style={{ color: '#722ed1' }} /> 费曼技巧指南</Space>}
                      style={{ borderRadius: 12 }}
                    >
                      <div style={{ fontSize: 13, lineHeight: 2, color: '#595959' }}>
                        <p><Text strong style={{ color: '#d4380d' }}>第1步：选择概念</Text><br />选一个你正在学习或觉得掌握不牢的知识点</p>
                        <p><Text strong style={{ color: '#d4380d' }}>第2步：讲授</Text><br />用最简单的语言写出来，假装在教一个小学生</p>
                        <p><Text strong style={{ color: '#d4380d' }}>第3步：找缺口</Text><br />AI会帮你发现哪里卡壳、哪里讲不清楚</p>
                        <p><Text strong style={{ color: '#d4380d' }}>第4步：简化提炼</Text><br />回到资料复习，用更简洁的语言重新组织</p>
                      </div>
                      <Divider style={{ margin: '12px 0' }} />
                      <Alert
                        message="学习小贴士"
                        description="研究表明：能用自己的话讲清楚，记忆留存率高达90%！"
                        type="success"
                        showIcon
                        style={{ borderRadius: 8, fontSize: 12 }}
                      />
                    </Card>
                  </Col>
                </Row>
              </div>
            ),
          },
        ]}
      />

      <Modal
        title={
          <Space>
            <ThunderboltOutlined style={{ color: '#ff4d4f' }} />
            <span>反向训练 · {currentReverse?.category}</span>
            {currentReverse?.weak_points && (
              <Space size={4}>
                {currentReverse.weak_points.map((p, i) => (
                  <Tag key={i} color="red" style={{ borderRadius: 4, margin: 0 }}>{p}</Tag>
                ))}
              </Space>
            )}
          </Space>
        }
        open={reverseModalVisible}
        onCancel={() => { setReverseModalVisible(false); setCurrentReverse(null); setReverseResult(null); setChatHistory([]) }}
        footer={null}
        width={700}
        destroyOnHidden
      >
        <div style={{ maxHeight: 500, overflowY: 'auto', marginBottom: 16 }}>
          {chatHistory.map((msg, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              {msg.role === 'system' && (
                <Alert message={msg.content} type="info" showIcon style={{ borderRadius: 8, fontSize: 13 }} />
              )}
              {msg.role === 'question' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg, #ff4d4f, #cf1322)',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
                  }}>题</div>
                  <div style={{
                    flex: 1, background: '#fff1f0', border: '1px solid #ffa39e',
                    borderRadius: '2px 10px 10px 10px', padding: '10px 14px', fontSize: 14, lineHeight: 1.7,
                  }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    {currentReverse?.key_points?.length > 0 && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #ffa39e' }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>本题踩分点：</Text>
                        <div style={{ marginTop: 4 }}>
                          {currentReverse.key_points.map((kp, ki) => (
                            <Tag key={ki} color="red" style={{ margin: '2px 4px 2px 0', borderRadius: 4 }}>{kp}</Tag>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {msg.role === 'user' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{
                    maxWidth: '80%', background: 'linear-gradient(135deg, #1677ff, #0958d9)', color: '#fff',
                    borderRadius: '10px 10px 2px 10px', padding: '10px 14px', fontSize: 14, lineHeight: 1.7,
                  }}>
                    {msg.content}
                  </div>
                </div>
              )}
              {msg.role === 'ai' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    background: msg.corrected ? 'linear-gradient(135deg, #52c41a, #389e0d)' : 'linear-gradient(135deg, #faad14, #d48806)',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
                  }}>
                    {msg.corrected ? <CheckCircleOutlined /> : <WarningOutlined />}
                  </div>
                  <div style={{ flex: 1 }}>
                    {msg.score !== undefined && (
                      <Space style={{ marginBottom: 6 }}>
                        <Tag color={scoreColor(msg.score)} style={{ borderRadius: 4 }}>得分: {msg.score}</Tag>
                        {msg.corrected ? <Tag color="success" icon={<CheckCircleOutlined />}>已攻克！</Tag> : <Tag color="warning">仍需加强</Tag>}
                      </Space>
                    )}
                    <div style={{
                      background: msg.corrected ? '#f6ffed' : '#fffbe6',
                      border: `1px solid ${msg.corrected ? '#b7eb8f' : '#ffe58f'}`,
                      borderRadius: '2px 10px 10px 10px', padding: '10px 14px', fontSize: 14, lineHeight: 1.7,
                    }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {!reverseResult && currentReverse && (
          <div>
            <TextArea
              rows={4}
              placeholder="请输入你的回答..."
              value={reverseAnswer}
              onChange={e => setReverseAnswer(e.target.value)}
              style={{ borderRadius: 8, marginBottom: 12 }}
            />
            <div style={{ textAlign: 'right' }}>
              <Space>
                <Button onClick={() => setReverseModalVisible(false)}>取消</Button>
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={reverseSubmitting}
                  onClick={submitReverseAnswer}
                  style={{ borderRadius: 8, background: '#ff4d4f', boxShadow: 'none' }}
                >
                  提交回答
                </Button>
              </Space>
            </div>
          </div>
        )}
        {reverseResult && (
          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => { setReverseModalVisible(false); setCurrentReverse(null); setReverseResult(null); setChatHistory([]) }}>关闭</Button>
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                onClick={() => {
                  if (currentReverse) startReverseTraining({ category: currentReverse.category }, { id: currentReverse.weakness_id, weak_points: currentReverse.weak_points })
                }}
                style={{ borderRadius: 8 }}
              >
                再练一题
              </Button>
            </Space>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default WrongNotebook
