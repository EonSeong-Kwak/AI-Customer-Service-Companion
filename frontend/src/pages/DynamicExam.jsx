import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Typography, Card, Button, Input, Space, message, Modal, Progress, Tag, Tooltip,
  Row, Col, Statistic, Table, Empty, Spin, Alert, Divider, List, Descriptions, Popconfirm, Select
} from 'antd'
import {
  SendOutlined, RobotOutlined, CheckCircleOutlined, CloseCircleOutlined,
  MinusCircleOutlined, ArrowUpOutlined, ArrowDownOutlined, FireOutlined,
  ThunderboltOutlined, AimOutlined, TrophyOutlined, WarningOutlined,
  AlertOutlined, SwapOutlined, ReloadOutlined, HistoryOutlined, FieldTimeOutlined,
  DeleteOutlined
} from '@ant-design/icons'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, Legend, ReferenceLine
} from 'recharts'
import axios from 'axios'
import { API_V1 } from '../config/api'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input

// Axios 实例：动态考试接口基础地址
const api = axios.create({
  baseURL: API_V1,
  timeout: 60000,
})

// ===== 烦躁值颜色映射（0-100，五档颜色） =====
const getAnxietyColor = (v) => {
  if (v <= 30) return '#52c41a'      // 绿色：平和
  if (v <= 50) return '#faad14'      // 黄色：略不耐烦
  if (v <= 70) return '#fa8c16'      // 橙色：明显烦躁
  if (v <= 85) return '#f5222d'      // 红色：威胁投诉
  return '#820014'                    // 深红：准备挂断
}

// 情绪状态 -> 标签颜色
const getEmotionTagColor = (emotion) => {
  if (!emotion) return 'default'
  if (emotion.includes('平和')) return 'success'
  if (emotion.includes('略')) return 'warning'
  if (emotion.includes('明显')) return 'orange'
  if (emotion.includes('威胁')) return 'error'
  if (emotion.includes('挂断')) return 'magenta'
  return 'default'
}

// 人格难度映射
const personaDifficultyMap = {
  '急躁型': { color: 'orange', difficulty: '中级' },
  '疑虑型': { color: 'blue', difficulty: '中级' },
  '普通型': { color: 'green', difficulty: '初级' },
  '愤怒型': { color: 'red', difficulty: '高级' },
}

const DynamicExam = () => {
  // ===== 考试主状态 =====
  const [examId, setExamId] = useState(null)
  const [examStatus, setExamStatus] = useState('idle') // idle | in_progress | completed | hangup
  const [personaType, setPersonaType] = useState('')
  const [initialAnxiety, setInitialAnxiety] = useState(0)
  const [anxietyThreshold, setAnxietyThreshold] = useState(80)
  const [currentAnxiety, setCurrentAnxiety] = useState(0)
  const [lastAnxietyChange, setLastAnxietyChange] = useState(0)
  const [emotionState, setEmotionState] = useState('')
  const [currentBusinessLine, setCurrentBusinessLine] = useState('')
  const [goals, setGoals] = useState([])
  const [currentRound, setCurrentRound] = useState(0)
  const [maxRounds, setMaxRounds] = useState(15)
  const [expectedRounds, setExpectedRounds] = useState(12)
  const [businessLinesCovered, setBusinessLinesCovered] = useState([])
  const [keyPointsHit, setKeyPointsHit] = useState([])
  const [triggeredRules, setTriggeredRules] = useState([])

  // ===== V3.4: 意图状态机 + PBL 项目制 =====
  const [examMode, setExamMode] = useState('single') // 'single' | 'project'
  const [intentState, setIntentState] = useState(null) // 当前意图状态快照
  const [taskState, setTaskState] = useState(null)     // 当前任务状态快照（项目制模式）
  const [intentHistory, setIntentHistory] = useState([]) // 意图切换历史
  const [taskHistory, setTaskHistory] = useState([])     // 任务切换历史（项目制模式）

  // ===== 对话历史 =====
  const [chatHistory, setChatHistory] = useState([]) // {role: 'customer'|'trainee', content, round}

  // ===== 输入与加载 =====
  const [inputText, setInputText] = useState('')
  const [starting, setStarting] = useState(false)
  const [sending, setSending] = useState(false)
  const [ending, setEnding] = useState(false)

  // ===== 弹窗队列 =====
  // 同时可能触发多种弹窗（突发状况、情绪安抚、业务线切换、结果报告），按优先级排队展示
  const [modalQueue, setModalQueue] = useState([])
  const [activeModal, setActiveModal] = useState(null) // 'emergency' | 'anxiety' | 'switch' | 'result'

  // 各弹窗数据
  const [emergencyData, setEmergencyData] = useState(null)
  const [anxietyWarningData, setAnxietyWarningData] = useState(null)
  const [switchData, setSwitchData] = useState(null)
  const [finalReport, setFinalReport] = useState(null)

  // ===== 历史记录抽屉 =====
  const [historyVisible, setHistoryVisible] = useState(false)
  const [historyList, setHistoryList] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [selectedHistoryDetail, setSelectedHistoryDetail] = useState(null)

  const chatScrollRef = useRef(null)

  // ===== 客户人格选择（可选，不选则和以前一样随机抽取）=====
  const [personaOptions, setPersonaOptions] = useState([])
  const [selectedPersonaId, setSelectedPersonaId] = useState(undefined)

  useEffect(() => {
    api.get('/personas').then(res => {
      setPersonaOptions(res.data || [])
    }).catch(() => {
      // 拉取失败不影响开考，下拉框留空即可，后端没收到 persona_id 会自动随机
    })
  }, [])

  // 对话区自动滚动到底部
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [chatHistory])

  // ===== 弹窗队列处理：弹出一个，关闭后弹下一个 =====
  const pushModals = useCallback((items) => {
    setModalQueue(prev => {
      const next = [...prev, ...items]
      setActiveModal(cur => cur || next[0] || null)
      return next
    })
  }, [])

  const closeActiveModal = useCallback(() => {
    setActiveModal(null)
    setModalQueue(prev => {
      const rest = prev.slice(1)
      if (rest.length > 0) {
        // 延迟切换，避免动画冲突
        setTimeout(() => setActiveModal(rest[0]), 150)
      }
      return rest
    })
  }, [])

  // ===== 开始考试 =====
  const handleStartExam = async () => {
    setStarting(true)
    setChatHistory([])
    setFinalReport(null)
    setEmergencyData(null)
    setAnxietyWarningData(null)
    setSwitchData(null)
    setModalQueue([])
    setActiveModal(null)
    try {
      const res = await api.post('/dynamic-exam/start', { persona_id: selectedPersonaId || null }, { timeout: 180000 })
      const data = res.data
      setExamId(data.exam_id)
      setExamStatus('in_progress')
      setPersonaType(data.persona_type)
      setInitialAnxiety(data.initial_anxiety)
      setAnxietyThreshold(data.anxiety_threshold)
      setCurrentAnxiety(data.initial_anxiety)
      setLastAnxietyChange(0)
      setEmotionState(data.emotion_state)
      setCurrentBusinessLine(data.current_business_line)
      setGoals(data.goals || [])
      setMaxRounds(data.max_rounds)
      setExpectedRounds(data.expected_rounds)
      setBusinessLinesCovered([data.current_business_line])
      setCurrentRound(0)
      setKeyPointsHit([])
      setTriggeredRules([])
      // V3.4: 意图/任务状态
      setExamMode(data.exam_mode || 'single')
      setIntentState(data.intent_state || null)
      setTaskState(data.task_state || null)
      setIntentHistory([])
      setTaskHistory([])
      // 加入客户开场白
      setChatHistory([{ role: 'customer', content: data.opening_message, round: 0 }])
      message.success('考试已开始，请认真接待客户')
    } catch (err) {
      message.error('开始考试失败: ' + (err.response?.data?.detail || err.message))
    } finally {
      setStarting(false)
    }
  }

  // ===== 发送回答 =====
  const handleSend = async () => {
    const text = inputText.trim()
    if (!text) return
    if (!examId) {
      message.warning('请先开始考试')
      return
    }
    if (examStatus !== 'in_progress') {
      message.warning('当前考试已结束')
      return
    }

    setInputText('')
    // 先把考生回答放入对话历史
    setChatHistory(prev => [...prev, { role: 'trainee', content: text, round: currentRound + 1 }])

    setSending(true)
    // 记录发送前的业务线，用于判断是否发生业务线切换
    const beforeLine = currentBusinessLine

    try {
      const res = await api.post('/dynamic-exam/chat', { exam_id: examId, message: text }, { timeout: 180000 })
      const data = res.data

      // 更新各项状态
      setCurrentRound(data.round)
      setCurrentAnxiety(data.anxiety)
      setLastAnxietyChange(data.anxiety_change)
      setEmotionState(data.emotion_state)
      setGoals(data.goals || [])
      setMaxRounds(data.max_rounds)
      setBusinessLinesCovered(data.business_lines_covered || businessLinesCovered)
      setKeyPointsHit(data.key_points_hit || [])
      setTriggeredRules(data.triggered_rules || [])

      // V3.4: 更新意图/任务状态
      setExamMode(data.exam_mode || 'single')
      setIntentState(data.intent_state || null)
      setTaskState(data.task_state || null)
      setIntentHistory(data.intent_history || [])
      setTaskHistory(data.task_history || [])

      // V3.4: 意图切换提示
      if (data.intent_switched) {
        const prev = data.intent_state?.current_intent?.name
        message.info({
          content: `客户意图推进：${prev ? '→ ' + prev : '已推进到下一意图'}`,
          duration: 3,
          icon: <AimOutlined style={{ color: '#722ed1' }} />
        })
      }
      // V3.4: 任务切换提示（项目制模式）
      if (data.task_switched) {
        const cur = data.task_state?.current_task?.name
        message.success({
          content: `项目任务推进：${cur ? '→ ' + cur : '已推进到下一任务'}`,
          duration: 3,
          icon: <ThunderboltOutlined style={{ color: '#52c41a' }} />
        })
      }

      // 业务线发生变化
      const lineChanged = data.current_business_line && data.current_business_line !== beforeLine
      if (lineChanged) {
        setCurrentBusinessLine(data.current_business_line)
      }

      // 加入客户回复
      setChatHistory(prev => [...prev, { role: 'customer', content: data.customer_reply, round: data.round }])

      // 按优先级构建弹窗队列：情绪安抚 -> 业务线切换
      // V3.2: 突发情况已融入客户回复（聊天气泡），不再用弹窗，改用轻提示
      const queue = []
      if (data.emergency_triggered) {
        message.warning({
          content: `⚠️ 突发状况来袭：${data.emergency_triggered.type}，请在下轮妥善应对`,
          duration: 4,
        })
      }
      if (data.emergency && data.emergency_result) {
        // 上一轮突发情况的应对评估结果
        if (data.emergency_result.success) {
          message.success({
            content: `突发状况应对成功（+${data.emergency_result.score}分）`,
            duration: 3,
          })
        } else {
          message.warning({
            content: `突发状况应对不充分（+${data.emergency_result.score}分），要点：${(data.emergency.handling_points || []).join('、')}`,
            duration: 4,
          })
        }
      }
      if (data.anxiety_warning) {
        setAnxietyWarningData(data.anxiety_warning)
        queue.push('anxiety')
      }
      if (data.all_goals_done && lineChanged) {
        setSwitchData({
          newLine: data.current_business_line,
          oldLine: beforeLine,
          goals: data.goals || [],
          expectedRounds: expectedRounds,
        })
        queue.push('switch')
      }

      // 考试结束：自动调用 end 接口拿报告
      if (data.status && data.status !== 'in_progress') {
        setExamStatus(data.status)
        if (data.end_reason) {
          message.warning(`考试结束：${data.end_reason}`)
        }
        // 先展示队列中的弹窗，最后展示结果报告
        await fetchFinalReport(queue.length > 0)
        if (queue.length === 0) {
          setActiveModal('result')
        } else {
          pushModals([...queue, 'result'])
        }
      } else if (queue.length > 0) {
        pushModals(queue)
      }
    } catch (err) {
      message.error('发送失败: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSending(false)
    }
  }

  // ===== 获取最终报告 =====
  const fetchFinalReport = async (silent = false) => {
    if (!examId) return
    setEnding(true)
    try {
      const res = await api.post('/dynamic-exam/end', { exam_id: examId })
      setFinalReport(res.data)
      setExamStatus(res.data.status || 'completed')
    } catch (err) {
      if (!silent) {
        message.error('生成考试报告失败: ' + (err.response?.data?.detail || err.message))
      }
    } finally {
      setEnding(false)
    }
  }

  // ===== 手动结束考试 =====
  const handleEndExam = async () => {
    if (!examId) return
    if (chatHistory.length === 0) {
      message.warning('当前还没有进行任何对话')
      return
    }
    Modal.confirm({
      title: '确认结束考试？',
      content: '结束后将生成考试结果报告，无法继续作答。',
      okText: '结束考试',
      okType: 'danger',
      cancelText: '继续答题',
      onOk: async () => {
        setExamStatus('completed')
        await fetchFinalReport(false)
        setActiveModal('result')
      },
    })
  }

  // ===== 加载历史记录 =====
  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      const res = await api.get('/dynamic-exam/history')
      setHistoryList(res.data || [])
      setHistoryVisible(true)
    } catch (err) {
      message.error('加载历史记录失败: ' + (err.response?.data?.detail || err.message))
    } finally {
      setHistoryLoading(false)
    }
  }

  // 查看历史详情
  const loadHistoryDetail = async (examIdArg) => {
    try {
      const res = await api.get(`/dynamic-exam/${examIdArg}/detail`)
      setSelectedHistoryDetail(res.data)
    } catch (err) {
      message.error('加载详情失败: ' + (err.response?.data?.detail || err.message))
    }
  }

  // ===== 恢复进行中的考试 =====
  const handleResumeExam = async (examIdArg) => {
    try {
      const res = await api.post(`/dynamic-exam/${examIdArg}/resume`, {}, { timeout: 180000 })
      const data = res.data
      // 重置所有状态
      setExamId(data.exam_id)
      setExamStatus('in_progress')
      setPersonaType(data.persona_type)
      setInitialAnxiety(data.initial_anxiety)
      setAnxietyThreshold(data.anxiety_threshold)
      setCurrentAnxiety(data.current_anxiety)
      setLastAnxietyChange(0)
      setEmotionState(data.emotion_state)
      setCurrentBusinessLine(data.current_business_line)
      setGoals(data.goals || [])
      setMaxRounds(data.max_rounds)
      setExpectedRounds(data.expected_rounds)
      setCurrentRound(data.current_round)
      setBusinessLinesCovered(data.business_lines_covered || [])
      setKeyPointsHit([])
      setTriggeredRules([])
      setFinalReport(null)
      setEmergencyData(null)
      setAnxietyWarningData(null)
      setSwitchData(null)
      setModalQueue([])
      setActiveModal(null)
      // 恢复对话历史
      const restoredChat = (data.chat_history || []).map(c => ({
        role: c.role,
        content: c.content,
        round: c.round || 0
      }))
      setChatHistory(restoredChat)
      setHistoryVisible(false)
      message.success(data.resumed_from_cache ? '已从内存恢复考试进度' : '已从数据库恢复考试进度')
    } catch (err) {
      message.error('恢复考试失败: ' + (err.response?.data?.detail || err.message))
    }
  }

  // ===== 删除考试记录 =====
  const handleDeleteExam = async (examIdArg) => {
    try {
      await api.delete(`/dynamic-exam/${examIdArg}`)
      message.success('考试记录已删除')
      // 如果删除的是当前正在进行的考试，重置界面
      if (examIdArg === examId) {
        handleReset()
      }
      // 刷新历史列表
      loadHistory()
    } catch (err) {
      message.error('删除失败: ' + (err.response?.data?.detail || err.message))
    }
  }

  // ===== 重新开始 =====
  const handleReset = () => {
    setExamId(null)
    setExamStatus('idle')
    setChatHistory([])
    setFinalReport(null)
    setActiveModal(null)
    setModalQueue([])
    setEmergencyData(null)
    setAnxietyWarningData(null)
    setSwitchData(null)
    setInputText('')
    setCurrentAnxiety(0)
    setLastAnxietyChange(0)
    setEmotionState('')
    setGoals([])
    setCurrentRound(0)
    setBusinessLinesCovered([])
    setKeyPointsHit([])
    setTriggeredRules([])
  }

  // ===== 阈值差值计算 =====
  const thresholdDiff = anxietyThreshold - currentAnxiety

  // ===== 渲染顶部状态栏 =====
  const renderStatusBar = () => {
    const personaInfo = personaDifficultyMap[personaType] || { color: 'default', difficulty: '-' }
    const anxietyColor = getAnxietyColor(currentAnxiety)
    const completedGoals = goals.filter(g => g.completed).length

    return (
      <Card
        size="small"
        style={{ flexShrink: 0, marginBottom: 0, borderRadius: '8px 8px 0 0', border: '1px solid #e8e8e8' }}
        styles={{ body: { padding: '12px 16px' } }}
      >
        {/* 第一行：轮次 + 烦躁值 + 情绪 + 阈值 */}
        <Row gutter={[12, 8]} align="middle">
          <Col flex="180px">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FieldTimeOutlined style={{ color: '#1d39c4' }} />
              <Text strong>轮次进度</Text>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1d39c4', marginTop: 2 }}>
              第 {currentRound} 轮 / 共 {maxRounds} 轮
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>预期 {expectedRounds} 轮完成</Text>
          </Col>

          <Col flex="auto">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <FireOutlined style={{ color: anxietyColor }} />
              <Text strong>客户烦躁值</Text>
              <span style={{ fontSize: 20, fontWeight: 800, color: anxietyColor }}>{currentAnxiety}</span>
              <span style={{ color: '#8c8c8c', fontSize: 13 }}>/ 100</span>
              {/* 烦躁值趋势 */}
              {lastAnxietyChange !== 0 && (
                <Tag
                  color={lastAnxietyChange > 0 ? 'error' : 'success'}
                  icon={lastAnxietyChange > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                  style={{ marginLeft: 8 }}
                >
                  {lastAnxietyChange > 0 ? `+${lastAnxietyChange}` : lastAnxietyChange}
                </Tag>
              )}
            </div>
            {/* 烦躁值进度条：颜色随数值变化 */}
            <Progress
              percent={currentAnxiety}
              strokeColor={anxietyColor}
              trailColor="#f0f0f0"
              strokeWidth={14}
              format={() => ''}
              showInfo={false}
            />
          </Col>

          <Col flex="220px">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertOutlined style={{ color: getEmotionTagColor(emotionState) === 'success' ? '#52c41a' : '#fa541c' }} />
              <Text strong>情绪状态</Text>
            </div>
            <div style={{ marginTop: 4 }}>
              <Tag color={getEmotionTagColor(emotionState)} style={{ fontSize: 14, padding: '2px 10px' }}>
                {emotionState || '未知'}
              </Tag>
            </div>
            {/* 阈值提示 */}
            <Tooltip title="烦躁值达到阈值时会触发情绪安抚环节">
              <div style={{ fontSize: 12, color: thresholdDiff > 0 ? '#8c8c8c' : '#f5222d', marginTop: 4 }}>
                阈值 {anxietyThreshold} ·{' '}
                {thresholdDiff > 0
                  ? `距触发安抚还差 ${thresholdDiff} 点`
                  : thresholdDiff === 0
                    ? '已达阈值，需立即安抚'
                    : `已超阈值 ${Math.abs(thresholdDiff)} 点`}
              </div>
            </Tooltip>
          </Col>
        </Row>

        <Divider style={{ margin: '10px 0' }} />

        {/* 第二行：人格 + 业务线 + 目标进度 */}
        <Row gutter={[12, 8]} align="middle">
          <Col flex="220px">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <RobotOutlined style={{ color: '#722ed1' }} />
              <Text strong>客户人格</Text>
              <Tag color={personaInfo.color}>{personaType}</Tag>
              <Tag>{personaInfo.difficulty}</Tag>
            </div>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>
              初始烦躁值：<Text strong style={{ color: '#fa541c' }}>{initialAnxiety}</Text>
              <span style={{ margin: '0 8px' }}>·</span>
              阈值：<Text strong style={{ color: '#fa541c' }}>{anxietyThreshold}</Text>
            </div>
          </Col>

          <Col flex="180px">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AimOutlined style={{ color: '#13c2c2' }} />
              <Text strong>当前业务线</Text>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#13c2c2', marginTop: 2 }}>
              {currentBusinessLine || '-'}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              已覆盖 {businessLinesCovered.length} 条业务线
            </Text>
          </Col>

          <Col flex="auto">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <CheckCircleOutlined style={{ color: completedGoals === goals.length ? '#52c41a' : '#faad14' }} />
              <Text strong>业务目标进度</Text>
              <Tag color={completedGoals === goals.length ? 'success' : 'processing'}>
                {completedGoals} / {goals.length}
              </Tag>
            </div>
            {/* 目标列表 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {goals.length === 0 && <Text type="secondary" style={{ fontSize: 12 }}>暂无目标</Text>}
              {goals.map((g, idx) => {
                const icon = g.completed
                  ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                  : g.started
                    ? <CloseCircleOutlined style={{ color: '#faad14' }} />
                    : <MinusCircleOutlined style={{ color: '#bfbfbf' }} />
                return (
                  <Tag
                    key={g.id || idx}
                    color={g.completed ? 'success' : 'default'}
                    icon={icon}
                    style={{ fontSize: 12 }}
                  >
                    {g.name}
                    {g.completed && g.completed_round ? `（第${g.completed_round}轮）` : ''}
                  </Tag>
                )
              })}
            </div>
          </Col>
        </Row>

        {/* V3.4: 意图状态机 + PBL 项目制追踪面板 */}
        {examMode === 'project' && taskState && renderProjectTracking()}
        {examMode === 'single' && intentState && renderIntentTracking()}
      </Card>
    )
  }

  // ===== V3.4: 渲染 PBL 项目制追踪面板 =====
  const renderProjectTracking = () => {
    if (!taskState) return null
    const {
      project_name, project_description,
      current_task, current_task_index,
      total_tasks, completed_tasks,
      task_rounds, task_completed,
      intent_state
    } = taskState

    return (
      <div style={{
        marginTop: 12, paddingTop: 12,
        borderTop: '1px dashed #d9d9d9'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <ThunderboltOutlined style={{ color: '#722ed1' }} />
          <Text strong style={{ color: '#722ed1' }}>PBL 项目制追踪</Text>
          <Tag color="purple">{project_name || '未知项目'}</Tag>
          <Tag color={completed_tasks === total_tasks ? 'success' : 'processing'}>
            任务 {completed_tasks} / {total_tasks}
          </Tag>
        </div>

        {project_description && (
          <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8 }}>
            {project_description}
          </div>
        )}

        {/* 任务进度条 */}
        <Progress
          percent={total_tasks > 0 ? Math.round(completed_tasks / total_tasks * 100) : 0}
          size="small"
          strokeColor="#722ed1"
          style={{ marginBottom: 8 }}
        />

        {/* 任务列表 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {Array.from({ length: total_tasks }).map((_, idx) => {
            const isCurrent = idx === current_task_index
            const isDone = task_completed[idx]
            const rounds = task_rounds[idx] || 0
            return (
              <Tag
                key={idx}
                color={isDone ? 'success' : isCurrent ? 'purple' : 'default'}
                icon={
                  isDone
                    ? <CheckCircleOutlined />
                    : isCurrent
                      ? <ThunderboltOutlined />
                      : <MinusCircleOutlined />
                }
                style={{ fontSize: 12 }}
              >
                {`任务${idx + 1}：`}
                {isCurrent || isDone ? (current_task?.name || '已完成') : `待完成`}
                {rounds > 0 && ` (${rounds}轮)`}
              </Tag>
            )
          })}
        </div>

        {/* 当前任务的意图状态 */}
        {intent_state && (
          <div style={{
            background: '#f9f0ff', padding: '8px 12px',
            borderRadius: 6, border: '1px solid #d3adf7'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <AimOutlined style={{ color: '#722ed1', fontSize: 12 }} />
              <Text strong style={{ fontSize: 12, color: '#722ed1' }}>当前任务意图</Text>
              <Tag color="purple" style={{ fontSize: 11 }}>
                {intent_state.completed_intents} / {intent_state.total_intents}
              </Tag>
            </div>
            {intent_state.current_intent ? (
              <div style={{ fontSize: 12 }}>
                <Text strong style={{ color: '#531dab' }}>
                  {intent_state.current_intent.name}
                </Text>
                {intent_state.current_intent.description && (
                  <div style={{ color: '#8c8c8c', marginTop: 2 }}>
                    {intent_state.current_intent.description}
                  </div>
                )}
                {intent_state.no_progress_count > 0 && (
                  <div style={{ color: '#fa541c', marginTop: 2, fontSize: 11 }}>
                    ⚠ 连续 {intent_state.no_progress_count} 轮无推进
                  </div>
                )}
              </div>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>所有意图已完成</Text>
            )}
          </div>
        )}

        {/* 任务切换历史（实时追踪） */}
        {taskHistory && taskHistory.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              <HistoryOutlined /> 任务推进历史：
            </Text>
            <div style={{ marginTop: 4 }}>
              {taskHistory.map((t, idx) => (
                <Tag key={idx} color="purple" style={{ fontSize: 11, marginBottom: 4 }}>
                  第{t.round}轮：{t.previous_task} → {t.current_task || '完成'}
                  {t.reason ? `（${t.reason}）` : ''}
                </Tag>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ===== V3.4: 渲染单业务线意图追踪面板 =====
  const renderIntentTracking = () => {
    if (!intentState) return null
    const {
      current_intent, intent_stack,
      current_index, total_intents, completed_intents,
      no_progress_count
    } = intentState

    return (
      <div style={{
        marginTop: 12, paddingTop: 12,
        borderTop: '1px dashed #d9d9d9'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <AimOutlined style={{ color: '#722ed1' }} />
          <Text strong style={{ color: '#722ed1' }}>客户意图追踪</Text>
          <Tag color={completed_intents === total_intents ? 'success' : 'purple'}>
            意图 {completed_intents} / {total_intents}
          </Tag>
        </div>

        {/* 意图进度条 */}
        <Progress
          percent={total_intents > 0 ? Math.round(completed_intents / total_intents * 100) : 0}
          size="small"
          strokeColor="#722ed1"
          style={{ marginBottom: 8 }}
        />

        {/* 当前意图 */}
        {current_intent ? (
          <div style={{
            background: '#f9f0ff', padding: '8px 12px',
            borderRadius: 6, border: '1px solid #d3adf7',
            marginBottom: 8
          }}>
            <div style={{ fontSize: 12 }}>
              <Text strong style={{ color: '#531dab' }}>
                当前诉求（第 {current_index + 1} / {total_intents} 个）：{current_intent.name}
              </Text>
              {current_intent.description && (
                <div style={{ color: '#8c8c8c', marginTop: 2 }}>
                  {current_intent.description}
                </div>
              )}
              {no_progress_count > 0 && (
                <div style={{ color: '#fa541c', marginTop: 2, fontSize: 11 }}>
                  ⚠ 连续 {no_progress_count} 轮无推进，可能强制切换
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{
            background: '#f6ffed', padding: '8px 12px',
            borderRadius: 6, border: '1px solid #b7eb8f',
            marginBottom: 8
          }}>
            <Text style={{ color: '#52c41a', fontSize: 12 }}>
              <CheckCircleOutlined /> 所有意图已完成
            </Text>
          </div>
        )}

        {/* 意图历史时间线 */}
        {intent_stack && intent_stack.length > 0 && (
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>意图栈：</Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {intent_stack.map((name, idx) => (
                <Tag key={idx} color="default" style={{ fontSize: 11 }}>
                  {idx + 1}. {name}
                </Tag>
              ))}
            </div>
          </div>
        )}

        {/* 意图切换历史（实时追踪） */}
        {intentHistory && intentHistory.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              <HistoryOutlined /> 意图推进历史：
            </Text>
            <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {intentHistory.map((t, idx) => (
                <Tag key={idx} color="default" style={{ fontSize: 11 }}>
                  第{t.round}轮：{t.previous_intent} → {t.current_intent || '完成'}
                </Tag>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ===== 渲染对话区（气泡样式：客户左侧、考生右侧） =====
  const renderChatArea = () => {
    return (
      <div
        ref={chatScrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px 24px',
          background: '#f5f7fa',
          borderLeft: '1px solid #e8e8e8',
          borderRight: '1px solid #e8e8e8',
        }}
      >
        {chatHistory.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: '#bfbfbf',
          }}>
            <RobotOutlined style={{ fontSize: 72, marginBottom: 16, opacity: 0.4 }} />
            <div style={{ fontSize: 18, fontWeight: 500 }}>动态模拟考试系统</div>
            <div style={{ marginTop: 8, fontSize: 13, textAlign: 'center' }}>
              点击下方"开始考试"按钮，可选择客户人格，业务线仍由系统随机抽取
            </div>
          </div>
        ) : (
          chatHistory.map((chat, idx) => {
            const isTrainee = chat.role === 'trainee'
            return (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  flexDirection: isTrainee ? 'row-reverse' : 'row',
                  marginBottom: 18,
                  alignItems: 'flex-start',
                }}
              >
                <div style={{
                  width: 38, height: 38, borderRadius: '50%',
                  background: isTrainee ? '#1d39c4' : '#fff',
                  color: isTrainee ? '#fff' : '#722ed1',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  marginLeft: isTrainee ? 12 : 0,
                  marginRight: isTrainee ? 0 : 12,
                  flexShrink: 0, border: isTrainee ? 'none' : '1px solid #e8e8e8',
                }}>
                  {isTrainee ? '我' : <RobotOutlined />}
                </div>
                <div style={{ maxWidth: '72%' }}>
                  {!isTrainee && (
                    <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 4, marginLeft: 4 }}>
                      客户 · 第 {chat.round} 轮
                    </div>
                  )}
                  {isTrainee && (
                    <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 4, marginRight: 4, textAlign: 'right' }}>
                      我的回答 · 第 {chat.round} 轮
                    </div>
                  )}
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: isTrainee ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                    background: isTrainee ? '#1d39c4' : '#fff',
                    color: isTrainee ? '#fff' : '#333',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                    lineHeight: 1.6, fontSize: 14, wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                    border: isTrainee ? 'none' : '1px solid #ececec',
                  }}>
                    {chat.content}
                  </div>
                </div>
              </div>
            )
          })
        )}
        {/* 踩分点命中提示（若有） */}
        {keyPointsHit.length > 0 && sending && (
          <div style={{ textAlign: 'center', color: '#8c8c8c', fontSize: 12 }}>
            <Spin size="small" /> 客户正在思考...
          </div>
        )}
      </div>
    )
  }

  // ===== 渲染底部输入区 =====
  const renderInputArea = () => {
    const disabled = examStatus !== 'in_progress'
    return (
      <Card
        size="small"
        style={{ flexShrink: 0, borderRadius: '0 0 8px 8px', border: '1px solid #e8e8e8', borderTop: 'none' }}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <TextArea
          rows={3}
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          placeholder={disabled ? '考试未开始或已结束' : '请输入您的回复话术（Enter 发送，Shift+Enter 换行）...'}
          disabled={disabled}
          bordered={false}
          style={{ resize: 'none', padding: '0 0 10px 0', fontSize: 14 }}
          onPressEnter={e => {
            if (!e.shiftKey) {
              e.preventDefault()
              if (!sending && !disabled) handleSend()
            }
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f0f0f0', paddingTop: 10 }}>
          <div style={{ color: '#bfbfbf', fontSize: 12 }}>
            {triggeredRules.length > 0 && (
              <Tooltip title={triggeredRules.join('；')}>
                <span style={{ marginRight: 12 }}>
                  <ThunderboltOutlined style={{ color: '#faad14', marginRight: 4 }} />
                  上轮触发 {triggeredRules.length} 条规则
                </span>
              </Tooltip>
            )}
            <kbd style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4 }}>Enter</kbd> 发送
          </div>
          <Space>
            <Button
              danger
              ghost
              icon={<TrophyOutlined />}
              loading={ending}
              onClick={handleEndExam}
              disabled={disabled || chatHistory.length === 0}
              style={{ borderRadius: 20 }}
            >
              结束考试
            </Button>
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={sending}
              onClick={handleSend}
              disabled={disabled}
              style={{ borderRadius: 20, padding: '0 28px' }}
            >
              发送回答
            </Button>
          </Space>
        </div>
      </Card>
    )
  }

  // ===== 渲染初始状态的"开始考试"按钮 =====
  const renderIdleMask = () => {
    if (examStatus !== 'idle' || chatHistory.length > 0) return null
    return (
      <div style={{
        position: 'absolute', inset: 0, background: 'rgba(245,247,250,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5,
      }}>
        <Card style={{ width: 460, textAlign: 'center', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
          <RobotOutlined style={{ fontSize: 56, color: '#1d39c4', marginBottom: 12 }} />
          <Title level={4} style={{ marginBottom: 8 }}>动态模拟考试</Title>
          <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 20 }}>
            系统将随机抽取业务线、烦躁值阈值与业务目标，<br />
            全程 10-15 轮对话，综合考察业务能力、情绪管理与应变能力。
          </Paragraph>
          <Select
            allowClear
            placeholder="客户人格：不选则随机抽取"
            style={{ width: 280, marginBottom: 16, textAlign: 'left' }}
            value={selectedPersonaId}
            onChange={setSelectedPersonaId}
            options={personaOptions.map(p => ({
              value: p.id,
              label: p.description ? `${p.name}（${p.description}）` : p.name,
            }))}
          />
          <br />
          <Button
            type="primary"
            size="large"
            icon={<ThunderboltOutlined />}
            loading={starting}
            onClick={handleStartExam}
            style={{ borderRadius: 24, padding: '0 36px', height: 44 }}
          >
            开始考试
          </Button>
        </Card>
      </div>
    )
  }

  // ===== 弹窗：突发状况 =====
  const renderEmergencyModal = () => {
    return (
      <Modal
        title={<Space><AlertOutlined style={{ color: '#f5222d' }} /> 🚨 突发状况</Space>}
        open={activeModal === 'emergency'}
        onOk={closeActiveModal}
        onCancel={closeActiveModal}
        okText="开始应对"
        cancelText="关闭"
        centered
        maskClosable={false}
        width={560}
      >
        {emergencyData && (
          <div>
            <Alert
              type="error"
              showIcon
              message="客户突然说："
              description={<Text strong style={{ fontSize: 15 }}>"{emergencyData.customer_line}"</Text>}
              style={{ marginBottom: 16 }}
            />
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="状况类型">
                <Tag color="red">{emergencyData.type}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="状况描述">{emergencyData.description}</Descriptions.Item>
              <Descriptions.Item label="🔍 应对要点">
                <List
                  size="small"
                  split={false}
                  dataSource={emergencyData.handling_points || []}
                  renderItem={item => (
                    <List.Item style={{ padding: '2px 0' }}>
                      <Text>• {item}</Text>
                    </List.Item>
                  )}
                />
              </Descriptions.Item>
              <Descriptions.Item label="⏱ 限时">
                <Tag color="orange">1 轮内恢复对话</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="📊 得分规则">
                正确应对 <Text strong type="success">+15 分</Text>，处理失败 <Text strong type="danger">-10 分</Text>
              </Descriptions.Item>
            </Descriptions>
            <Alert
              type="warning"
              message="请在下一轮回答中按要点妥善应对，系统将自动评估处理得分。"
              showIcon
              style={{ marginTop: 12 }}
            />
          </div>
        )}
      </Modal>
    )
  }

  // ===== 弹窗：情绪安抚环节 =====
  const renderAnxietyModal = () => {
    return (
      <Modal
        title={<Space><WarningOutlined style={{ color: '#fa541c' }} /> ⚠️ 紧急：客户情绪安抚环节</Space>}
        open={activeModal === 'anxiety'}
        onOk={closeActiveModal}
        onCancel={closeActiveModal}
        okText="开始安抚"
        cancelText="关闭"
        centered
        maskClosable={false}
        width={560}
      >
        {anxietyWarningData && (
          <div>
            <Alert
              type="error"
              showIcon
              message={anxietyWarningData.message}
              description={<span>当前情绪状态：<Tag color={getEmotionTagColor(emotionState)}>{emotionState}</Tag></span>}
              style={{ marginBottom: 16 }}
            />
            <Card size="small" title="📊 烦躁值变化与安抚建议" style={{ marginBottom: 12 }}>
              <div style={{ marginBottom: 8 }}>
                <Progress
                  percent={currentAnxiety}
                  strokeColor={getAnxietyColor(currentAnxiety)}
                  strokeWidth={12}
                  format={p => `${p} / 100`}
                />
              </div>
              <Divider style={{ margin: '10px 0' }} />
              <div style={{ fontWeight: 600, marginBottom: 6 }}>💡 安抚建议：</div>
              <Paragraph style={{ whiteSpace: 'pre-wrap', color: '#595959', marginBottom: 8 }}>
                {anxietyWarningData.suggestion}
              </Paragraph>
              <List
                size="small"
                split={false}
                dataSource={[
                  '表达同理心："我理解您的心情，遇到这种情况确实让人着急..."',
                  '主动道歉："非常抱歉给您带来不便，这是我这边的问题..."',
                  '给出明确承诺："我会立即帮您处理，请稍等我马上核实..."',
                ]}
                renderItem={(item, idx) => (
                  <List.Item style={{ padding: '3px 0' }}>
                    <Text>{idx + 1}. {item}</Text>
                  </List.Item>
                )}
              />
            </Card>
            <Alert
              type="warning"
              showIcon
              message={`⏱ 限时要求：${anxietyWarningData.time_limit}`}
              style={{ marginBottom: 8 }}
            />
            <Alert
              type="error"
              showIcon
              message="若未在限时内将烦躁值降至安全区间，客户将挂断电话，考试判定失败。"
            />
          </div>
        )}
      </Modal>
    )
  }

  // ===== 弹窗：业务线切换 =====
  const renderSwitchModal = () => {
    return (
      <Modal
        title={<Space><SwapOutlined style={{ color: '#1677ff' }} /> 📢 业务线切换</Space>}
        open={activeModal === 'switch'}
        onOk={closeActiveModal}
        onCancel={closeActiveModal}
        okText="开始新业务线"
        cancelText="关闭"
        centered
        maskClosable={false}
        width={560}
      >
        {switchData && (
          <div>
            <Alert
              type="success"
              showIcon
              message={`当前业务线「${switchData.oldLine}」目标已全部达成！`}
              description="根据业务关联图谱，自动切换到下一业务线。"
              style={{ marginBottom: 16 }}
            />
            <Card size="small" title={`📋 新业务线：${switchData.newLine}`} style={{ marginBottom: 12 }}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="新业务线">
                  <Tag color="cyan" style={{ fontSize: 14 }}>{switchData.newLine}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="🎯 业务目标">
                  <List
                    size="small"
                    split={false}
                    dataSource={switchData.goals}
                    renderItem={(g, idx) => (
                      <List.Item style={{ padding: '2px 0' }}>
                        <Text>{idx + 1}. {g.name}（{g.max_rounds || 2} 轮内完成）</Text>
                      </List.Item>
                    )}
                  />
                </Descriptions.Item>
                <Descriptions.Item label="⏱ 预期轮数">
                  {(switchData.goals?.length || 0) + 2} 轮
                </Descriptions.Item>
                <Descriptions.Item label="🔗 关联原因">
                  业务关联图谱：{switchData.oldLine} → {switchData.newLine}
                </Descriptions.Item>
              </Descriptions>
            </Card>
            <Alert
              type="info"
              showIcon
              message="新业务线的客户问题即将开始，请注意切换话术与思路。"
            />
          </div>
        )}
      </Modal>
    )
  }

  // ===== 弹窗：考试结果报告 =====
  const renderResultModal = () => {
    if (!finalReport) return null
    const score = finalReport.final_score || {}
    const anxietyHistory = finalReport.anxiety_history || []
    const businessLineProgress = finalReport.business_line_progress || []
    const weaknessTags = score.weakness_tags || []
    const details = score.score_details || {}

    // 烦躁值曲线数据
    const chartData = anxietyHistory.map(h => ({
      round: `第${h.round}轮`,
      anxiety: h.anxiety,
    }))

    // 业务线完成情况表格数据
    const tableData = businessLineProgress.map((p, idx) => ({
      key: idx,
      business_line: p.business_line,
      goals_total: (p.goals?.length || 0),
      goals_done: (p.goals_completed?.length || 0),
      rounds_used: p.rounds_used,
      rounds_expected: p.rounds_expected,
      completed: p.completed,
      score: p.goals?.length > 0
        ? Math.round((p.goals_completed?.length || 0) / p.goals.length * 100)
        : 0,
    }))

    const totalGoals = tableData.reduce((s, r) => s + r.goals_total, 0)
    const totalDone = tableData.reduce((s, r) => s + r.goals_done, 0)
    const totalRounds = tableData.reduce((s, r) => s + r.rounds_used, 0)
    const totalExpected = tableData.reduce((s, r) => s + r.rounds_expected, 0)

    const overallColor = score.overall_score >= 80 ? '#52c41a'
      : score.overall_score >= 60 ? '#faad14' : '#f5222d'

    const dimensionColor = (s) => s >= 80 ? '#52c41a' : s >= 60 ? '#faad14' : '#f5222d'

    // 改进建议（V5.0：专业知识/服务态度/沟通效率/问题解决 四维度）
    const suggestions = []
    if (score.business_score < 70) suggestions.push('加强业务知识学习，重点复习未完成目标对应的知识点文档')
    if (score.emotion_score < 70) suggestions.push('学习"客户情绪安抚技巧"知识点，掌握同理心表达与主动道歉话术')
    if (score.efficiency_score < 70) suggestions.push('提升服务效率，控制单轮回复时长，避免冗余术语堆砌')
    if (score.bonus_score < 70) suggestions.push('加强方案完整性与客户执行引导，确保客户真正理解并接受解决方案')
    if (details.threshold_exceeded_count > 0) suggestions.push(`烦躁值曾 ${details.threshold_exceeded_count} 次超阈值，需强化情绪预警意识`)
    if (score.compliance_passed === false) suggestions.push(`合规性问题：${score.compliance_reason || '存在违规行为'}，综合分已被扣减，务必遵守服务规范`)
    weaknessTags.forEach(t => {
      if (t.dimension === 'knowledge') suggestions.push(`进行反向训练：针对「${t.tag}」的错题变种`)
    })
    if (suggestions.length === 0) suggestions.push('表现优秀，建议保持当前节奏并挑战更高难度人格')

    return (
      <Modal
        title={<Space><TrophyOutlined style={{ color: '#faad14' }} /> 📊 考试结果报告</Space>}
        open={activeModal === 'result'}
        onOk={handleReset}
        onCancel={() => setActiveModal(null)}
        okText="重新考试"
        cancelText="关闭查看"
        centered
        maskClosable={false}
        width={820}
        footer={[
          <Button key="history" icon={<HistoryOutlined />} onClick={() => { setActiveModal(null); loadHistory() }}>
            查看历史记录
          </Button>,
          <Button key="close" onClick={() => setActiveModal(null)}>关闭</Button>,
          <Button key="reset" type="primary" icon={<ReloadOutlined />} onClick={handleReset}>
            重新考试
          </Button>,
        ]}
      >
        <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: 8 }}>
          {/* 综合得分 + 三维度 */}
          <Row gutter={16} align="middle" style={{ marginBottom: 16 }}>
            <Col span={8} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>🏆 综合得分</div>
              <div style={{ fontSize: 56, fontWeight: 800, color: overallColor, lineHeight: 1 }}>
                {score.overall_score}
              </div>
              <div style={{ color: '#8c8c8c', fontSize: 12 }}>分</div>
              <Tag color={finalReport.status === 'hangup' ? 'error' : 'success'} style={{ marginTop: 8 }}>
                {finalReport.status === 'hangup' ? '客户挂断' : '正常结束'}
              </Tag>
              <br />
              <Tag color={score.compliance_passed === false ? 'error' : 'default'} style={{ marginTop: 6 }}>
                {score.compliance_passed === false ? `合规性：违规（${score.compliance_reason || ''}）` : '合规性：通过'}
              </Tag>
            </Col>
            <Col span={16}>
              {/* V5.0 五维度评分体系：专业知识40% + 服务态度25% + 沟通效率15% + 问题解决20%，权重固定，与考试模式无关 */}
              <Row gutter={[8, 8]}>
                <Col span={6}>
                  <Card size="small" style={{ textAlign: 'center', borderTop: `3px solid ${dimensionColor(score.business_score)}` }}>
                    <Statistic
                      title="专业知识分 (40%)"
                      value={score.business_score}
                      valueStyle={{ color: dimensionColor(score.business_score), fontWeight: 700, fontSize: 20 }}
                    />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card size="small" style={{ textAlign: 'center', borderTop: `3px solid ${dimensionColor(score.emotion_score)}` }}>
                    <Statistic
                      title="服务态度分 (25%)"
                      value={score.emotion_score}
                      valueStyle={{ color: dimensionColor(score.emotion_score), fontWeight: 700, fontSize: 20 }}
                    />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card size="small" style={{ textAlign: 'center', borderTop: `3px solid ${dimensionColor(score.efficiency_score)}` }}>
                    <Statistic
                      title="沟通效率分 (15%)"
                      value={score.efficiency_score}
                      valueStyle={{ color: dimensionColor(score.efficiency_score), fontWeight: 700, fontSize: 20 }}
                    />
                  </Card>
                </Col>
                <Col span={6}>
                  <Card size="small" style={{ textAlign: 'center', borderTop: `3px solid ${dimensionColor(score.bonus_score)}` }}>
                    <Statistic
                      title="问题解决分 (20%)"
                      value={score.bonus_score}
                      valueStyle={{ color: dimensionColor(score.bonus_score), fontWeight: 700, fontSize: 20 }}
                    />
                  </Card>
                </Col>
              </Row>
              {/* V3.4: 项目制附加维度——统一展示，非项目制考试无对应数据时显示 0 */}
              <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
                <Col span={8}>
                  <Card size="small" style={{ textAlign: 'center', borderTop: `3px solid ${dimensionColor(details.project_score || 0)}` }}>
                    <Statistic
                      title="项目任务分"
                      value={details.project_score ?? 0}
                      valueStyle={{ color: dimensionColor(details.project_score || 0), fontWeight: 700, fontSize: 18 }}
                    />
                  </Card>
                </Col>
                <Col span={8}>
                  <Card size="small" style={{ textAlign: 'center', borderTop: `3px solid ${dimensionColor(details.flow_coherence_score || 0)}` }}>
                    <Statistic
                      title="流程连贯性"
                      value={details.flow_coherence_score ?? 0}
                      valueStyle={{ color: dimensionColor(details.flow_coherence_score || 0), fontWeight: 700, fontSize: 18 }}
                    />
                  </Card>
                </Col>
                <Col span={8}>
                  <Card size="small" style={{ textAlign: 'center', borderTop: `3px solid ${dimensionColor(details.adaptability_score || 0)}` }}>
                    <Statistic
                      title="应变能力"
                      value={details.adaptability_score ?? 0}
                      valueStyle={{ color: dimensionColor(details.adaptability_score || 0), fontWeight: 700, fontSize: 18 }}
                    />
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      突发{details.emergency_total || 0}次 · 成功{details.emergency_success || 0}次
                    </Text>
                  </Card>
                </Col>
              </Row>
            </Col>
          </Row>

          {/* V3.4: 意图/任务切换历史 */}
          {(details.intent_history?.length > 0 || details.task_history?.length > 0) && (
            <Card size="small" title="🎯 意图/任务推进历史" style={{ marginBottom: 16 }}>
              {details.task_history?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <Text strong style={{ color: '#722ed1' }}>任务切换历史：</Text>
                  <div style={{ marginTop: 4 }}>
                    {details.task_history.map((t, idx) => (
                      <Tag key={idx} color="purple" style={{ marginBottom: 4 }}>
                        第{t.round}轮：{t.previous_task} → {t.current_task || '完成'}（{t.reason}）
                      </Tag>
                    ))}
                  </div>
                </div>
              )}
              {details.intent_history?.length > 0 && (
                <div>
                  <Text strong style={{ color: '#531dab' }}>意图切换历史：</Text>
                  <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {details.intent_history.map((t, idx) => (
                      <Tag key={idx} color="default" style={{ fontSize: 11 }}>
                        第{t.round}轮：{t.previous_intent} → {t.current_intent || '完成'}
                      </Tag>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* 烦躁值变化曲线 */}
          <Card size="small" title="📈 烦躁值变化曲线" style={{ marginBottom: 16 }}>
            {chartData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="round" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <RTooltip
                      formatter={(v) => [`${v}`, '烦躁值']}
                      labelFormatter={(l) => `${l}`}
                    />
                    <Legend />
                    <ReferenceLine y={anxietyThreshold} stroke="#f5222d" strokeDasharray="4 4"
                      label={{ value: `阈值 ${anxietyThreshold}`, fill: '#f5222d', fontSize: 10, position: 'right' }} />
                    <Line
                      type="monotone"
                      dataKey="anxiety"
                      name="烦躁值"
                      stroke="#fa541c"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: '#fa541c' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <Row gutter={16} style={{ marginTop: 8 }}>
                  <Col span={8}>
                    <Statistic title="初始烦躁值" value={initialAnxiety} valueStyle={{ fontSize: 16 }} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="最高烦躁值" value={details.anxiety_drop != null ? (initialAnxiety - details.anxiety_drop) : '-'}
                      valueStyle={{ fontSize: 16, color: '#f5222d' }} />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="净变化"
                      value={details.anxiety_drop > 0 ? `-${details.anxiety_drop}` : (details.anxiety_drop < 0 ? `+${Math.abs(details.anxiety_drop)}` : 0)}
                      valueStyle={{ fontSize: 16, color: details.anxiety_drop > 0 ? '#52c41a' : '#f5222d' }}
                    />
                  </Col>
                </Row>
                <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>
                  超阈值次数：<Text strong type={details.threshold_exceeded_count > 0 ? 'danger' : 'success'}>
                    {details.threshold_exceeded_count || 0} 次
                  </Text>
                  <span style={{ margin: '0 8px' }}>·</span>
                  实际轮数：{details.actual_rounds} / 预期 {details.expected_rounds} 轮
                </div>
              </>
            ) : (
              <Empty description="暂无烦躁值数据" />
            )}
          </Card>

          {/* 业务线完成情况表格 */}
          <Card size="small" title="📋 业务线完成情况" style={{ marginBottom: 16 }}>
            <Table
              size="small"
              dataSource={tableData}
              pagination={false}
              columns={[
                { title: '业务线', dataIndex: 'business_line', key: 'business_line',
                  render: (v, r) => <Space><Tag color={r.completed ? 'success' : 'default'}>{v}</Tag></Space> },
                { title: '目标数', dataIndex: 'goals_total', key: 'goals_total', align: 'center' },
                { title: '完成数', dataIndex: 'goals_done', key: 'goals_done', align: 'center',
                  render: (v, r) => <Text style={{ color: v === r.goals_total ? '#52c41a' : '#faad14' }}>{v}</Text> },
                { title: '使用轮数', dataIndex: 'rounds_used', key: 'rounds_used', align: 'center',
                  render: (v, r) => <Text type={v > r.rounds_expected ? 'danger' : 'secondary'}>{v} / {r.rounds_expected}</Text> },
                { title: '得分', dataIndex: 'score', key: 'score', align: 'center',
                  render: (v) => <Tag color={v >= 80 ? 'success' : v >= 60 ? 'warning' : 'error'}>{v}</Tag> },
                { title: '状态', dataIndex: 'completed', key: 'completed', align: 'center',
                  render: (v) => v ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                    : <CloseCircleOutlined style={{ color: '#f5222d' }} /> },
              ]}
            />
            <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>
              总完成度：{totalDone} / {totalGoals}（{totalGoals > 0 ? Math.round(totalDone / totalGoals * 100) : 0}%）
              <span style={{ margin: '0 8px' }}>·</span>
              总轮数：{totalRounds} / 预期 {totalExpected}
            </div>
          </Card>

          {/* 弱点标签 */}
          <Card size="small" title="🔥 弱点标签" style={{ marginBottom: 16 }}>
            {weaknessTags.length === 0 ? (
              <Alert type="success" showIcon message="本次考试未发现明显弱点，表现优秀！" />
            ) : (
              <Space wrap>
                {weaknessTags.map((t, idx) => {
                  const colorMap = { business: 'orange', emotion: 'magenta', efficiency: 'gold' }
                  return (
                    <Tag key={idx} color={colorMap[t.dimension] || 'default'} icon={<WarningOutlined />} style={{ marginBottom: 4 }}>
                      {t.tag}
                    </Tag>
                  )
                })}
              </Space>
            )}
          </Card>

          {/* 改进建议 */}
          <Card size="small" title="💡 改进建议">
            <List
              size="small"
              dataSource={suggestions}
              renderItem={(item, idx) => (
                <List.Item style={{ padding: '4px 0' }}>
                  <Text>{idx + 1}. {item}</Text>
                </List.Item>
              )}
            />
          </Card>
        </div>
      </Modal>
    )
  }

  // ===== 历史记录详情弹窗 =====
  const renderHistoryDetailModal = () => {
    if (!selectedHistoryDetail) return null
    const d = selectedHistoryDetail
    const anxietyHistory = d.anxiety_history || []
    const chartData = anxietyHistory.map(h => ({ round: `第${h.round}轮`, anxiety: h.anxiety }))
    const overallColor = d.overall_score >= 80 ? '#52c41a' : d.overall_score >= 60 ? '#faad14' : '#f5222d'

    return (
      <Modal
        title="历史考试详情"
        open={!!selectedHistoryDetail}
        onCancel={() => setSelectedHistoryDetail(null)}
        footer={[<Button key="close" onClick={() => setSelectedHistoryDetail(null)}>关闭</Button>]}
        width={760}
      >
        <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={6} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 36, fontWeight: 800, color: overallColor }}>{d.overall_score || 0}</div>
              <div style={{ color: '#8c8c8c', fontSize: 12 }}>综合得分</div>
              <Tag color={d.status === 'hangup' ? 'error' : 'success'} style={{ marginTop: 4 }}>
                {d.status === 'hangup' ? '挂断' : '正常'}
              </Tag>
            </Col>
            <Col span={18}>
              <Descriptions column={2} size="small" bordered>
                <Descriptions.Item label="人格">{d.persona_type}</Descriptions.Item>
                <Descriptions.Item label="业务线数">{d.business_lines_covered?.length || 0}</Descriptions.Item>
                <Descriptions.Item label="专业知识分 (40%)">{d.business_score}</Descriptions.Item>
                <Descriptions.Item label="服务态度分 (25%)">{d.emotion_score}</Descriptions.Item>
                <Descriptions.Item label="沟通效率分 (15%)">{d.efficiency_score}</Descriptions.Item>
                <Descriptions.Item label="问题解决分 (20%)">{d.bonus_score}</Descriptions.Item>
                <Descriptions.Item label="总轮数">{d.total_rounds} / {d.max_rounds}</Descriptions.Item>
                <Descriptions.Item label="烦躁值">{d.initial_anxiety} → {d.final_anxiety}</Descriptions.Item>
              </Descriptions>
            </Col>
          </Row>
          {chartData.length > 0 && (
            <Card size="small" title="烦躁值曲线" style={{ marginBottom: 12 }}>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="round" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} />
                  <RTooltip />
                  <Line type="monotone" dataKey="anxiety" name="烦躁值" stroke="#fa541c" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}
          <Card size="small" title="对话回放">
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {(d.chat_history || []).map((c, idx) => (
                <div key={idx} style={{ marginBottom: 8 }}>
                  <Text strong style={{ color: c.role === 'trainee' ? '#1d39c4' : '#722ed1' }}>
                    {c.role === 'trainee' ? '我' : '客户'}：
                  </Text>
                  <span style={{ whiteSpace: 'pre-wrap' }}>{c.content}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </Modal>
    )
  }

  // ===== 主页面渲染 =====
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 190px)', minHeight: 600 }}>
      {/* 顶部标题栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexShrink: 0 }}>
        <Title level={3} style={{ margin: 0 }}>
          <ThunderboltOutlined style={{ color: '#1d39c4', marginRight: 8 }} />
          动态模拟考试
          {personaType && <Tag color={personaDifficultyMap[personaType]?.color} style={{ marginLeft: 12, fontSize: 13 }}>{personaType}客户</Tag>}
        </Title>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleReset}
            disabled={examStatus === 'idle'}
          >
            重新开始
          </Button>
          <Button
            icon={<HistoryOutlined />}
            onClick={loadHistory}
            loading={historyLoading}
          >
            历史记录
          </Button>
        </Space>
      </div>

      {/* 主体：左侧聊天区 + 右侧监测面板 */}
      <div style={{ position: 'relative', flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左侧：聊天区域 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid #e8e8e8' }}>
          {renderChatArea()}
          {renderInputArea()}
        </div>
        {/* 右侧：监测面板 */}
        <div style={{ width: 320, flexShrink: 0, overflowY: 'auto', background: '#fafafa', borderLeft: '1px solid #e8e8e8' }}>
          {renderStatusBar()}
        </div>
        {renderIdleMask()}
      </div>

      {/* 各类弹窗 */}
      {/* V3.2: 突发情况已融入聊天，不再使用 Modal */}
      {renderAnxietyModal()}
      {renderSwitchModal()}
      {renderResultModal()}

      {/* 历史记录抽屉 */}
      <Modal
        title="动态考试历史记录"
        open={historyVisible}
        onCancel={() => setHistoryVisible(false)}
        footer={[<Button key="close" onClick={() => setHistoryVisible(false)}>关闭</Button>]}
        width={720}
      >
        <List
          loading={historyLoading}
          dataSource={historyList}
          locale={{ emptyText: <Empty description="暂无历史考试记录" /> }}
          renderItem={item => (
            <List.Item
              actions={[
                ...(item.status === 'in_progress' ? [
                  <Button
                    type="link"
                    style={{ color: '#fa541c' }}
                    icon={<ReloadOutlined />}
                    onClick={() => handleResumeExam(item.exam_id || item.id)}
                  >
                    恢复考试
                  </Button>,
                ] : []),
                <Button type="link" onClick={() => loadHistoryDetail(item.exam_id || item.id)}>查看详情</Button>,
                <Popconfirm
                  title="确认删除"
                  description="删除后无法恢复，确定删除这条考试记录吗？"
                  onConfirm={() => handleDeleteExam(item.exam_id || item.id)}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Tag color={item.status === 'hangup' ? 'error' : item.status === 'completed' ? 'success' : 'processing'}>
                      {item.status === 'hangup' ? '挂断' : item.status === 'completed' ? '已完成' : '进行中'}
                    </Tag>
                    <span>综合得分：<Text strong style={{ color: item.overall_score >= 80 ? '#52c41a' : item.overall_score >= 60 ? '#faad14' : '#f5222d' }}>{item.overall_score || 0}</Text></span>
                    <Tag>{item.persona_type}</Tag>
                  </Space>
                }
                description={
                  <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                    {item.created_at ? new Date(item.created_at).toLocaleString() : '时间未知'}
                    <span style={{ margin: '0 8px' }}>·</span>
                    轮数：{item.total_rounds || 0} / {item.max_rounds || 0}
                    <span style={{ margin: '0 8px' }}>·</span>
                    业务线：{(item.business_lines_covered || []).join('、') || '-'}
                  </div>
                }
              />
            </List.Item>
          )}
        />
        {renderHistoryDetailModal()}
      </Modal>
    </div>
  )
}

export default DynamicExam
