import React, { useState, useEffect, useRef } from 'react'
import { Tabs, Card, Typography, Input, Button, Space, message, Modal, Descriptions, Progress, List, Drawer, Tag, Divider, FloatButton, Statistic, Badge, Alert, Row, Col, Empty, Spin, Table } from 'antd'
import { SendOutlined, RobotOutlined, CheckCircleOutlined, HistoryOutlined, ClockCircleOutlined, BookOutlined, WarningOutlined, ThunderboltOutlined, AimOutlined, TrophyOutlined, FireOutlined, RiseOutlined, FileTextOutlined } from '@ant-design/icons'
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, LineChart, Line, Legend, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import axios from 'axios'

const { Title } = Typography
const { TextArea } = Input

// Axios 实例
const api = axios.create({
  baseURL: 'http://localhost:8000/api/v1',
  timeout: 30000,
})

const TraineePortal = () => {
  const [activeTab, setActiveTab] = useState('study')
  
  // 练习中心状态
  const [practiceCategories, setPracticeCategories] = useState([])
  const [selectedPracticeQuestion, setSelectedPracticeQuestion] = useState(null)
  const [selectedPracticeCategory, setSelectedPracticeCategory] = useState(null)
  const [practiceLoading, setPracticeLoading] = useState(false)

  // 反向训练推荐状态
  const [recommendation, setRecommendation] = useState(null)
  const [reverseTrainingIndex, setReverseTrainingIndex] = useState(-1)
  
  // 简单的聊天状态
  const [text, setText] = useState('')
  const [chatHistory, setChatHistory] = useState([])
  const [loading, setLoading] = useState(false)
  
  // 评分状态
  const [scoring, setScoring] = useState(false)
  const [scoreReport, setScoreReport] = useState(null)
  const [reportModalVisible, setReportModalVisible] = useState(false)
  
  // 历史记录状态
  const [historyDrawerVisible, setHistoryDrawerVisible] = useState(false)
  const [historyTab, setHistoryTab] = useState('exam')
  const [historyList, setHistoryList] = useState([])
  const [practiceHistoryList, setPracticeHistoryList] = useState([])
  const [practiceDetailVisible, setPracticeDetailVisible] = useState(false)
  const [currentPracticeDetail, setCurrentPracticeDetail] = useState(null)
  const [selectedHistoryChats, setSelectedHistoryChats] = useState([])
  const [selectedHistoryRecord, setSelectedHistoryRecord] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  // 学习大厅番茄钟与伴随式导师状态
  const [aiTutorVisible, setAiTutorVisible] = useState(false)
  const [pomodoroTime, setPomodoroTime] = useState(25 * 60) // 25分钟
  const [isPomodoroRunning, setIsPomodoroRunning] = useState(false)
  const [docChatHistory, setDocChatHistory] = useState([])
  const timerRef = useRef(null)

  // 纵向趋势分析
  const [trendData, setTrendData] = useState(null)
  // 费曼完成度
  const [feynmanProgress, setFeynmanProgress] = useState(null)
  const [feynmanModalVisible, setFeynmanModalVisible] = useState(false)
  const [feynmanTopic, setFeynmanTopic] = useState('')
  const [feynmanParaphrase, setFeynmanParaphrase] = useState('')
  const [feynmanResult, setFeynmanResult] = useState(null)
  const [feynmanSubmitting, setFeynmanSubmitting] = useState(false)
  // 教学题型
  const [teachingLoading, setTeachingLoading] = useState(false)
  // 能力画像
  const [capabilityPortrait, setCapabilityPortrait] = useState(null)
  const [portraitModalVisible, setPortraitModalVisible] = useState(false)
  // 番茄钟统计
  const [pomodoroStats, setPomodoroStats] = useState(null)
  // 反循环验证结果
  const [verifyResult, setVerifyResult] = useState(null)
  const [verifyModalVisible, setVerifyModalVisible] = useState(false)
  // 组卷考试
  const [examPapers, setExamPapers] = useState([])
  const [currentExamPaper, setCurrentExamPaper] = useState(null)
  const [examAnswers, setExamAnswers] = useState({})
  const [examSubmitLoading, setExamSubmitLoading] = useState(false)
  const [examResult, setExamResult] = useState(null)
  const [examResultVisible, setExamResultVisible] = useState(false)

  const loadPracticeCategories = async () => {
    setPracticeLoading(true)
    try {
      const res = await api.get('/practice/categories')
      setPracticeCategories(res.data)
    } catch (err) {
      message.error('加载题库分类失败: ' + err.message)
    } finally {
      setPracticeLoading(false)
    }
  }

  const loadRecommendation = async () => {
    try {
      const res = await api.get('/practice/recommended')
      setRecommendation(res.data)
    } catch (err) {
      // 静默失败，不影响正常练习
      setRecommendation({ has_recommendation: false, recommendations: [] })
    }
  }

  const handleStartReverseTraining = async (rec, idx) => {
    setReverseTrainingIndex(idx)
    try {
      const res = await api.post('/practice/reverse-training', {
        category: rec.category,
        weak_points: rec.weak_points
      }, { timeout: 120000 })
      if (res.data.status === 'success') {
        message.success(res.data.message)
        // 将生成的反向训练题作为当前练习题
        const q = res.data.question
        const newQuestion = {
          id: res.data.question_id,
          scenario: q.scenario,
          reference_answer: q.reference_answer,
          key_points: q.key_points,
          category: q.category || rec.category,
          difficulty: q.difficulty || 'medium',
          is_reverse_training: true,
          reverse_note: q.reverse_note
        }
        setSelectedPracticeQuestion(newQuestion)
        // 关键修复：设置聊天记录显示题目场景，和普通选题逻辑一致
        setChatHistory([{
          role: 'ai',
          content: `【反向训练题】\n薄弱点：${rec.weak_points.join('、')}\n\n【场景描述】\n${q.scenario}\n\n${q.reverse_note ? `> 设计说明：${q.reverse_note}\n\n` : ''}请写出您的回复话术：`
        }])
        // 重新加载推荐，清除已处理的
        loadRecommendation()
      }
    } catch (err) {
      message.error('生成反向训练题失败: ' + err.message)
    } finally {
      setReverseTrainingIndex(-1)
    }
  }

  // 纵向趋势分析
  const loadTrendData = async () => {
    try {
      const res = await api.get('/trend')
      setTrendData(res.data)
    } catch (err) { console.error('加载趋势失败', err) }
  }

  // 费曼完成度
  const loadFeynmanProgress = async () => {
    try {
      const res = await api.get('/feynman/progress')
      setFeynmanProgress(res.data)
    } catch (err) { console.error('加载费曼进度失败', err) }
  }

  const submitFeynman = async () => {
    if (!feynmanParaphrase.trim() || !feynmanTopic.trim()) {
      message.warning('请填写知识点主题和复述内容')
      return
    }
    setFeynmanSubmitting(true)
    try {
      const res = await api.post('/feynman/submit', { topic: feynmanTopic, paraphrase: feynmanParaphrase }, { timeout: 120000 })
      setFeynmanResult(res.data)
      loadFeynmanProgress()
    } catch (err) {
      message.error('提交失败: ' + err.message)
    } finally {
      setFeynmanSubmitting(false)
    }
  }

  // 教学题型
  const handleGenerateTeachingQuestion = async (category) => {
    setTeachingLoading(true)
    try {
      const res = await api.post('/practice/teaching-question', { category }, { timeout: 120000 })
      if (res.data.status === 'success') {
        message.success(res.data.message)
        const q = res.data.question
        setSelectedPracticeQuestion({
          id: res.data.question_id,
          scenario: q.scenario,
          reference_answer: q.reference_answer,
          key_points: q.key_points,
          category: q.category || category,
          difficulty: q.difficulty || 'medium',
          is_teaching: true,
          follow_up_questions: q.follow_up_questions || []
        })
        setChatHistory([{
          role: 'ai',
          content: `【教学题型】费曼学习法\n\n【场景描述】\n${q.scenario}\n\n${q.follow_up_questions ? `虚拟学员追问：\n${q.follow_up_questions.map((q,idx) => `${idx+1}. ${q}`).join('\n')}\n\n` : ''}请用通俗易懂的语言写出你的教学话术：`
        }])
      }
    } catch (err) {
      message.error('生成教学题型失败: ' + err.message)
    } finally {
      setTeachingLoading(false)
    }
  }

  // 能力画像
  const loadCapabilityPortrait = async () => {
    try {
      const res = await api.get('/capability-portrait')
      setCapabilityPortrait(res.data)
    } catch (err) { console.error('加载能力画像失败', err) }
  }

  // 番茄钟统计
  const loadPomodoroStats = async () => {
    try {
      const res = await api.get('/pomodoro/stats')
      setPomodoroStats(res.data)
    } catch (err) { console.error('加载番茄钟统计失败', err) }
  }

  const completePomodoro = async () => {
    try {
      const module = activeTab === 'practice' ? 'practice' : 'study'
      await api.post('/pomodoro/complete', { module, duration: 1500 })
      loadPomodoroStats()
    } catch (err) { console.error('记录番茄钟失败', err) }
  }

  // 反循环验证
  const handleVerifyCorrection = async (questionId, answer, weaknessId) => {
    try {
      const res = await api.post('/practice/verify-correction', {
        question_id: questionId,
        trainee_answer: answer,
        weakness_id: weaknessId
      }, { timeout: 120000 })
      setVerifyResult(res.data)
      setVerifyModalVisible(true)
      if (res.data.weakness_resolved) {
        loadRecommendation()
      }
    } catch (err) {
      message.error('验证失败: ' + err.message)
    }
  }

  // 组卷考试相关函数
  const loadExamPapers = async () => {
    try {
      const res = await api.get('/exam-papers')
      setExamPapers(res.data)
    } catch (err) {
      message.error('获取试卷列表失败: ' + err.message)
    }
  }

  const loadExamPaperDetail = async (paperId) => {
    try {
      const res = await api.get(`/exam-papers/${paperId}/detail`)
      setCurrentExamPaper(res.data)
      setExamAnswers({})
      res.data.questions.forEach(q => {
        setExamAnswers(prev => ({ ...prev, [q.id]: '' }))
      })
    } catch (err) {
      message.error('获取试卷详情失败: ' + err.message)
    }
  }

  const handleExamAnswerChange = (questionId, value) => {
    setExamAnswers(prev => ({ ...prev, [questionId]: value }))
  }

  const submitExam = async (assignmentId) => {
    const answers = Object.entries(examAnswers).map(([questionId, answer]) => ({
      question_id: questionId,
      answer: answer
    }))

    const allAnswered = answers.every(a => a.answer.trim())
    if (!allAnswered) {
      message.warning('请完成所有题目再提交')
      return
    }

    setExamSubmitLoading(true)
    try {
      const res = await api.post('/exam-papers/submit', {
        assignment_id: assignmentId,
        answers: answers
      }, { timeout: 180000 })
      setExamResult(res.data)
      setExamResultVisible(true)
      loadExamPapers()
    } catch (err) {
      message.error('提交试卷失败: ' + err.message)
    } finally {
      setExamSubmitLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'practice') {
      if (practiceCategories.length === 0) loadPracticeCategories()
      loadRecommendation()
    }
    if (activeTab === 'study') {
      loadFeynmanProgress()
      loadPomodoroStats()
    }
    if (activeTab === 'exam') {
      loadExamPapers()
    }
  }, [activeTab])

  const [aiTutorMode, setAiTutorMode] = useState('normal') // 'normal' or 'feynman'

  // 知识库文档阅读状态
  const [docDrawerVisible, setDocDrawerVisible] = useState(false)
  const [currentDocTopic, setCurrentDocTopic] = useState('')
  const [docAgentSources, setDocAgentSources] = useState(null)

  const docContents = {
    '密码重置与找回': `## 密码重置与找回业务规范

### 1. 手机银行登录密码
*   **支持线上自助找回**。客户需验证人脸、预留手机号及名下任意本行卡号。
*   **话术要点**：引导客户在APP登录页面点击“忘记密码”。

### 2. 取款密码（交易密码）
*   **不可纯线上找回**。需本人持身份证和银行卡至全国任意网点办理。
*   **特殊情况**：如果是人在国外，可提供护照/出入境记录，申请“特殊延期”或“代办只收不付”。
*   **行动不便的老人**：提供双人上门核保服务。

### 3. 密码锁定规则
*   **取款密码**：连续输错3次被锁定。密码锁定不自动解锁，需本人去网点解锁或重置。
*   **手机银行登录密码**：输错被锁后，次日凌晨0点自动解锁，或通过“忘记密码”重置立刻解锁。`,

    '账户受控排查': `## 账户受控排查业务规范

### 1. 长期不动户限制
*   **触发条件**：连续6个月无主动交易会被暂停非柜面业务。
*   **解除方案**：发生一笔动账（如转入1元）或在APP完成一次活体检测即可激活。

### 2. 反诈风控限制
*   **触发条件**：频繁快进快出、深夜大额交易等。
*   **解除方案**：需本人持证件及交易证明至网点核实。
*   **单日限额骤降**：如突然变为5000元，需客户至网点提供资产证明申请提额。

### 3. 司法冻结
*   **处理原则**：银行无权解冻司法冻结。
*   **话术要点**：需告知客户冻结机关名称及电话，由客户自行联系解决。有“全额冻结”和“限额冻结”两种情况。`,

    '信用卡挂失与补办': `## 信用卡挂失与补办业务规范

### 1. 临时挂失/一键锁卡
*   **适用场景**：信用卡找不到了，但可能在家里。
*   **特性**：免费且可自助恢复，期间卡片无法交易。

### 2. 正式挂失
*   **适用场景**：确认卡片被偷或丢失。
*   **特性**：立即办理，不可逆，需收费。
*   **关联影响**：新卡卡号一定会变，原绑定的微信/支付宝、水电费代扣协议必须重新绑定。但积分、账单、额度会自动平移。

### 3. 盗刷处理 SOP
1.  立刻挂失止付。
2.  引导客户就近进行一笔真卡交易（如ATM查询），证明卡在身边。
3.  报警并提交拒付调查。`,

    '客户预留信息更新': `## 客户预留信息更新规范

### 1. 身份证更新
*   **影响**：证件过期超过90天（或半年），将中止账户非柜面交易。
*   **线上办理**：登录手机银行，通过OCR扫描新身份证正反面并进行人脸识别。
*   **线下办理**：如果人脸识别提示“与公安系统照片不符”，需去网点人工核验。

### 2. 手机号更新
*   **原号码不可用时**：严禁纯线上更改绑定手机，必须去网点。

### 3. 职业与地址补充
*   **合规要求**：根据《反洗钱法》及“客户尽职调查(KYC)”的硬性合规要求。
*   **待业/自由职业**：如实填写“无业”或“自由职业”，并在地址栏填写实际居住地址。`,

    '远程银行首登有礼': `## 远程银行“首登有礼”活动介绍

### 1. 活动参与资格
*   **核心限制**：限历史**从未注册或登录过**手机银行APP的客户，首次下载登录即可参与。
*   **注销重开**：以前注册过后来注销的，再注册**不算**首登。首登严格判定为“历史首次”。

### 2. 活动奖励与发放
*   **奖励内容**：微信立减金或实物礼品。
*   **发放形式**：通过抽奖形式实时发放。`
  }

  // 番茄钟逻辑
  useEffect(() => {
    if (isPomodoroRunning && pomodoroTime > 0) {
      timerRef.current = setInterval(() => {
        setPomodoroTime(prev => prev - 1)
      }, 1000)
    } else if (isPomodoroRunning && pomodoroTime === 0) {
      clearInterval(timerRef.current)
      setIsPomodoroRunning(false)
      message.success('恭喜您完成了一次 25 分钟的专注学习！即将进入费曼挑战模式。')
      completePomodoro()

      // 自动触发费曼挑战
      setAiTutorMode('feynman')
      setAiTutorVisible(true)
      
      // 构造一个系统触发的事件，让后端直接发问
      setTimeout(() => {
        const triggerMessage = "师傅，我准备好向您请教了，您可以开始费曼挑战了。"
        const newHistory = [{ role: 'trainee', content: triggerMessage }]
        setDocChatHistory(newHistory)
        handleChatInternal(true, triggerMessage, newHistory, 'feynman')
      }, 1000)
    }
    return () => clearInterval(timerRef.current)
  }, [isPomodoroRunning, pomodoroTime])

  const togglePomodoro = () => {
    if (isPomodoroRunning) {
      setIsPomodoroRunning(false)
    } else {
      if (pomodoroTime === 0) setPomodoroTime(25 * 60)
      setIsPomodoroRunning(true)
    }
  }

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0')
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const handleSelectPracticeQuestion = (question) => {
    setSelectedPracticeQuestion(question)
    setChatHistory([{ role: 'ai', content: `【场景描述】\n${question.scenario}\n\n请写出您的回复话术：` }])
  }

  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      const res = await api.get('/history')
      setHistoryList(res.data)

      const practiceRes = await api.get('/practice/history')
      setPracticeHistoryList(practiceRes.data)

      setHistoryDrawerVisible(true)
      loadTrendData()
    } catch (err) {
      message.error('加载历史记录失败: ' + err.message)
    } finally {
      setHistoryLoading(false)
    }
  }

  const loadChatDetails = async (record) => {
    try {
      const res = await api.get(`/history/${record.id}`)
      setSelectedHistoryChats(res.data)
      setSelectedHistoryRecord(record)
    } catch (err) {
      message.error('加载对话详情失败: ' + err.message)
    }
  }

  useEffect(() => {
    // 每次聊天记录更新时，自动滚动到底部
    const container = document.getElementById('chat-scroll-container')
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [chatHistory, docChatHistory])

  const [docText, setDocText] = useState('')
  const [docLoading, setDocLoading] = useState(false)

  const handleChatInternal = async (isDocAgent, msg, historyToUse, overrideMode = null) => {
    if (isDocAgent) {
      setDocLoading(true)
    } else {
      setLoading(true)
    }
    
    const setTargetHistory = isDocAgent ? setDocChatHistory : setChatHistory

    try {
      let agentType = 'persona'
      if (isDocAgent) {
        agentType = 'doc'
      } else if (activeTab === 'practice') {
        agentType = 'quiz'
      } else if (activeTab === 'persona-exam') {
        agentType = 'persona'
      }

      const reqHistory = historyToUse.map(h => ({
        role: h.role,
        content: h.content
      }))

      const payload = {
        message: msg,
        agent_type: agentType,
        mode: overrideMode || (isDocAgent ? aiTutorMode : 'normal'),
        history: reqHistory,
        question_id: selectedPracticeQuestion?.id
      }

      setTargetHistory(prev => [...prev, { role: 'ai', content: '' }])

      const response = await fetch('http://localhost:8000/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.detail || '请求失败')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let aiMessage = ''
      let firstChunk = true

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        const chunk = decoder.decode(value, { stream: true })
        
        if (firstChunk && isDocAgent && chunk.startsWith('__KNOWLEDGE_SOURCES__:')) {
          const splitIdx = chunk.indexOf('\n')
          if (splitIdx !== -1) {
            const sourceStr = chunk.substring('__KNOWLEDGE_SOURCES__:'.length, splitIdx)
            try {
              const sources = JSON.parse(sourceStr)
              setDocAgentSources(sources)
            } catch (e) {
              console.error('Failed to parse knowledge sources', e)
            }
            const actualContent = chunk.substring(splitIdx + 1)
            if (actualContent) {
              aiMessage += actualContent
              setTargetHistory(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'ai', content: aiMessage }
                return updated
              })
            }
          }
        } else {
          aiMessage += chunk
          setTargetHistory(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'ai', content: aiMessage }
            return updated
          })
        }
        
        if (firstChunk) firstChunk = false
        
        if (isDocAgent) {
          const el = document.getElementById('doc-chat-scroll-container')
          if (el) el.scrollTop = el.scrollHeight
        } else {
          const el = document.getElementById('chat-scroll-container')
          if (el) el.scrollTop = el.scrollHeight
        }
      }
    } catch (err) {
      message.error('调用失败: ' + err.message)
      setTargetHistory(prev => {
        const updated = [...prev]
        if (updated[updated.length - 1].content === '') {
           updated.pop()
        }
        return updated
      })
    } finally {
      if (isDocAgent) {
        setDocLoading(false)
      } else {
        setLoading(false)
      }
    }
  }

  const handleChat = async (isDocAgent = false) => {
    const currentText = isDocAgent ? docText : text
    if (!currentText.trim()) return
    const msg = currentText
    
    if (isDocAgent) {
      setDocText('')
    } else {
      setText('')
    }
    
    const targetHistory = isDocAgent ? docChatHistory : chatHistory
    const setTargetHistory = isDocAgent ? setDocChatHistory : setChatHistory

    const newHistory = [...targetHistory, { role: 'trainee', content: msg }]
    setTargetHistory(newHistory)
    
    await handleChatInternal(isDocAgent, msg, newHistory)
  }

  const handleEndExam = async () => {
    if (chatHistory.length === 0) {
      message.warning('您还没有进行任何对话，无法评分')
      return
    }
    setScoring(true)
    try {
      const reqHistory = chatHistory.map(h => ({
        role: h.role,
        content: h.content
      }))
      const res = await api.post('/score', { history: reqHistory }, { timeout: 120000 })
      setScoreReport(res.data)
      setReportModalVisible(true)
    } catch (err) {
      message.error('评分生成失败: ' + (err.response?.data?.detail || err.message))
    } finally {
      setScoring(false)
    }
  }

  const renderPracticeSelection = () => (
    <div style={{ padding: '24px', minHeight: '500px', background: '#f8f9fa' }}>
      {/* 反向训练推荐横幅 */}
      {recommendation && recommendation.has_recommendation && (
        <Card 
          style={{ marginBottom: 24, borderColor: '#faad14', borderWidth: 2, background: '#fffbe6' }}
          bodyStyle={{ padding: '16px 24px' }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <WarningOutlined style={{ fontSize: 24, color: '#faad14', marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <Title level={5} style={{ margin: 0, color: '#d48806' }}>
                <ThunderboltOutlined /> 检测到薄弱知识点，建议优先进行反向训练
              </Title>
              <div style={{ marginTop: 12 }}>
                {recommendation.recommendations.map((rec, idx) => (
                  <div key={idx} style={{ 
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', marginBottom: 8, background: '#fff', borderRadius: 6,
                    border: '1px solid #ffe58f'
                  }}>
                    <div>
                      <Tag color="orange">{rec.category}</Tag>
                      <span style={{ marginLeft: 8, color: '#666' }}>
                        薄弱点：{rec.weak_points.join('、')}
                      </span>
                      <Tag color="red" style={{ marginLeft: 8 }}>上次得分：{rec.last_score}</Tag>
                    </div>
                    <Button 
                      type="primary" 
                      size="small"
                      loading={reverseTrainingIndex === idx}
                      disabled={reverseTrainingIndex !== -1 && reverseTrainingIndex !== idx}
                      onClick={() => handleStartReverseTraining(rec, idx)}
                      icon={<ThunderboltOutlined />}
                    >
                      生成错题变种
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      <div style={{ marginBottom: 16, display: 'flex', gap: 12 }}>
        <Button
          type="dashed"
          icon={<AimOutlined />}
          loading={teachingLoading}
          onClick={() => {
            // Use the first available category or prompt user
            const firstCat = practiceCategories[0]?.category || '通用业务'
            handleGenerateTeachingQuestion(firstCat)
          }}
        >
          生成教学题型（费曼学习法）
        </Button>
      </div>

      <Title level={4} style={{ marginBottom: 24 }}>
        {selectedPracticeCategory ? `${selectedPracticeCategory} - 题目列表` : '选择练习分类'}
      </Title>
      {selectedPracticeCategory ? (
        <div>
          <Button
            type="link"
            onClick={() => setSelectedPracticeCategory(null)}
            style={{ marginBottom: 16, paddingLeft: 0 }}
          >
            ← 返回分类列表
          </Button>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: 16 }}>
            {practiceCategories.find(c => c.category === selectedPracticeCategory)?.questions.map((q, idx) => (
              <Card 
                key={q.id}
                hoverable 
                style={{ width: 280, borderRadius: 8, cursor: 'pointer' }}
                onClick={() => handleSelectPracticeQuestion(q)}
                bodyStyle={{ padding: '16px' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 500, color: '#333' }}>练习 {idx + 1}</span>
                  <Tag color={q.difficulty === 'hard' ? 'red' : 'blue'}>{q.difficulty}</Tag>
                </div>
                <div style={{ 
                  color: '#666', 
                  fontSize: 13, 
                  display: '-webkit-box', 
                  WebkitLineClamp: 2, 
                  WebkitBoxOrient: 'vertical', 
                  overflow: 'hidden' 
                }}>
                  {q.scenario}
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
          {practiceCategories.map(cat => (
            <Card
              key={cat.category}
              hoverable
              style={{ width: 240, borderRadius: 8, cursor: 'pointer' }}
              onClick={() => setSelectedPracticeCategory(cat.category)}
              bodyStyle={{ padding: '20px' }}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>📚</div>
              <Title level={5} style={{ margin: 0, marginBottom: 4 }}>{cat.category}</Title>
              <div style={{ color: '#999', fontSize: 13 }}>
                共 {cat.questions?.length || 0} 道题
              </div>
            </Card>
          ))}
        </div>
      )}
      {practiceCategories.length === 0 && !practiceLoading && (
        <div style={{ textAlign: 'center', color: '#999', marginTop: 100 }}>暂无练习题，请在管理员端添加</div>
      )}
    </div>
  )

  const renderChatBox = (placeholder, isExam = false, isDocAgent = false) => {
    const currentHistory = isDocAgent ? docChatHistory : chatHistory
    const currentText = isDocAgent ? docText : text
    const setCurrentText = isDocAgent ? setDocText : setText
    const currentLoading = isDocAgent ? docLoading : loading

    const chatInterface = (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, borderRight: isDocAgent ? '1px solid #f0f0f0' : 'none' }}>
        <div 
          id={isDocAgent ? "doc-chat-scroll-container" : "chat-scroll-container"}
          style={{ 
            flex: 1, 
            overflowY: 'auto', 
            padding: '24px', 
            background: '#f8f9fa', 
            borderRadius: isDocAgent ? '0' : '12px 12px 0 0', 
            border: '1px solid #f0f0f0',
            borderBottom: 'none',
            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
          }}
        >
          {currentHistory.length === 0 ? (
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              justifyContent: 'center',
              height: '100%',
              color: '#bfbfbf' 
            }}>
              <RobotOutlined style={{ fontSize: 64, marginBottom: 16, opacity: 0.5 }} />
              <div style={{ fontSize: 16, fontWeight: 500 }}>{isExam ? 'AI 模拟客户已就绪' : (isDocAgent ? '伴随式导师已就绪' : 'AI 培训助手已就绪')}</div>
              <div style={{ marginTop: 8, fontSize: 13, textAlign: 'center' }}>{placeholder}</div>
            </div>
          ) : (
            currentHistory.map((chat, idx) => (
              <div 
                key={idx} 
                style={{ 
                  display: 'flex',
                  flexDirection: chat.role === 'trainee' ? 'row-reverse' : 'row',
                  marginBottom: '20px',
                  alignItems: 'flex-start'
                }}
              >
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: chat.role === 'trainee' ? '#1d39c4' : '#fff',
                  color: chat.role === 'trainee' ? '#fff' : '#1d39c4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  marginLeft: chat.role === 'trainee' ? 12 : 0,
                  marginRight: chat.role === 'trainee' ? 0 : 12,
                  flexShrink: 0
                }}>
                  {chat.role === 'trainee' ? '我' : <RobotOutlined />}
                </div>
                <div style={{
                  padding: '12px 16px',
                  borderRadius: chat.role === 'trainee' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                  background: chat.role === 'trainee' ? '#1d39c4' : '#fff',
                  color: chat.role === 'trainee' ? '#fff' : '#333',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                  maxWidth: '75%',
                  lineHeight: 1.6,
                  fontSize: 14,
                  wordBreak: 'break-word',
                  overflowX: 'auto'
                }}>
                  {chat.role === 'trainee' ? (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{chat.content}</div>
                  ) : (
                    <div className="markdown-body" style={{ margin: 0 }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {chat.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        <div style={{ 
          padding: '16px', 
          background: '#fff', 
          border: '1px solid #f0f0f0',
          borderRadius: isDocAgent ? '0' : '0 0 12px 12px',
          boxShadow: '0 -2px 10px rgba(0,0,0,0.02)'
        }}>
          <TextArea 
            rows={3} 
            value={currentText}
            onChange={e => setCurrentText(e.target.value)}
            placeholder={placeholder} 
            disabled={currentLoading}
            bordered={false}
            style={{ 
              resize: 'none', 
              padding: '0 0 12px 0',
              fontSize: 15,
              boxShadow: 'none'
            }}
            onPressEnter={e => {
              if (!e.shiftKey) {
                e.preventDefault()
                handleChat(isDocAgent)
              }
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
            <div style={{ color: '#bfbfbf', fontSize: 12 }}>
              <kbd style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4, marginRight: 4 }}>Enter</kbd> 发送
            </div>
            <Space>
              {activeTab === 'practice' && selectedPracticeQuestion && !isDocAgent && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {selectedPracticeQuestion.is_reverse_training && (
                    <Tag color="orange" icon={<ThunderboltOutlined />}>反向训练题</Tag>
                  )}
                  {selectedPracticeQuestion.is_reverse_training && chatHistory.filter(c => c.role === 'trainee').length > 0 && (
                    <Button
                      type="primary"
                      ghost
                      icon={<CheckCircleOutlined />}
                      onClick={() => {
                        const lastAnswer = chatHistory.filter(c => c.role === 'trainee').pop()?.content || ''
                        handleVerifyCorrection(selectedPracticeQuestion.id, lastAnswer, recommendation?.recommendations?.[0]?.weakness_id)
                      }}
                    >
                      验证修正结果
                    </Button>
                  )}
                  <Button
                    onClick={() => {
                      setSelectedPracticeQuestion(null)
                      setChatHistory([])
                    }}
                    style={{ borderRadius: 20 }}
                  >
                    返回题库
                  </Button>
                </div>
              )}
              {isExam && !isDocAgent && (
                <Button 
                  danger 
                  type="primary"
                  ghost
                  icon={<CheckCircleOutlined />} 
                  loading={scoring} 
                  onClick={handleEndExam}
                  style={{ borderRadius: 20 }}
                >
                  结束考试并评分
                </Button>
              )}
              <Button 
                type="primary" 
                icon={<SendOutlined />} 
                loading={currentLoading} 
                onClick={() => handleChat(isDocAgent)}
                style={{ borderRadius: 20, padding: '0 24px' }}
              >
                发送
              </Button>
            </Space>
          </div>
        </div>
      </div>
    )

    if (!isDocAgent) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 280px)', minHeight: '500px' }}>
          {chatInterface}
        </div>
      )
    }

    return (
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{ flex: '1.2', display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
          {chatInterface}
        </div>
        <div style={{ flex: '0.8', background: '#fafafa', padding: '20px', overflowY: 'auto', borderLeft: '1px solid #e8e8e8', minWidth: 0 }}>
          <Title level={5} style={{ marginBottom: 16, display: 'flex', alignItems: 'center' }}>
            <BookOutlined style={{ marginRight: 8, color: '#1677ff' }} />
            知识库检索与思考过程
          </Title>
          
          {!docAgentSources || docAgentSources.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#bfbfbf', marginTop: 60 }}>
              <RobotOutlined style={{ fontSize: 48, opacity: 0.2, marginBottom: 16 }} />
              <div>发起提问后，此处将展示 AI 的知识库检索过程。</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
                共检索到 <strong style={{ color: '#1677ff' }}>{docAgentSources.length}</strong> 条相关业务规则：
              </div>
              {docAgentSources.map((src, idx) => (
                <Card 
                  key={idx} 
                  size="small" 
                  title={
                    <Space>
                      <Tag color="blue">文档片段 {idx + 1}</Tag>
                      <span style={{ fontSize: 13, fontWeight: 'normal', color: '#666' }}>
                        相似度: <span style={{ color: '#52c41a', fontWeight: 'bold' }}>{src.similarity || '未知'}</span>
                      </span>
                    </Space>
                  }
                  style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.05)', borderRadius: 8, border: '1px solid #e8e8e8' }}
                  styles={{ header: { background: '#f0f5ff', padding: '0 12px', minHeight: 40 }, body: { padding: '12px' } }}
                >
                  <div style={{ 
                    fontSize: 13, 
                    color: '#333', 
                    lineHeight: 1.6,
                    maxHeight: '150px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {src.content}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderRadarChart = (scoreDetails) => {
    if (!scoreDetails) return null
    const data = [
      { subject: '业务准确性', A: scoreDetails.accuracy || 0, fullMark: 100 },
      { subject: '服务态度', A: scoreDetails.service_tone || 0, fullMark: 100 },
      { subject: '制度合规性', A: scoreDetails.compliance || 0, fullMark: 100 },
      { subject: '情绪安抚', A: scoreDetails.empathy || 0, fullMark: 100 },
      { subject: '沟通控场', A: scoreDetails.dialogue_control || 0, fullMark: 100 },
    ]

    return (
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
            <PolarGrid />
            <PolarAngleAxis dataKey="subject" tick={{ fill: '#333', fontSize: 12 }} />
            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} />
            <Radar name="得分" dataKey="A" stroke="#1d39c4" fill="#1d39c4" fillOpacity={0.5} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    )
  }

  const handleTabChange = (key) => {
    setActiveTab(key)
    // 切换 Tab 时清空聊天记录
    setChatHistory([])
    setText('')
    setSelectedPracticeQuestion(null)
    setSelectedPracticeCategory(null)
  }

  const renderExamCenter = () => (
    <div>
      {!currentExamPaper ? (
        <div>
          <Title level={4} style={{ marginBottom: 16 }}><FileTextOutlined /> 我的试卷</Title>
          {examPapers.length === 0 ? (
            <Empty description="暂无下发的试卷" />
          ) : (
            <Table
              dataSource={examPapers}
              columns={[
                { title: '试卷名称', dataIndex: 'title', key: 'title' },
                { title: '题目数量', dataIndex: 'question_ids', key: 'question_count', render: (ids) => ids?.length || 0 },
                { title: '状态', dataIndex: 'status', key: 'status', render: (status) => (
                  <Tag color={status === 'completed' ? 'success' : 'processing'}>
                    {status === 'completed' ? '已完成' : '待完成'}
                  </Tag>
                )},
                { title: '下发时间', dataIndex: 'created_at', key: 'created_at', render: (time) => time ? new Date(time).toLocaleString() : '-' },
                { title: '操作', key: 'action', render: (_, record) => (
                  <Space>
                    {record.status !== 'completed' && (
                      <Button 
                        type="primary" 
                        onClick={() => loadExamPaperDetail(record.paper_id)}
                      >
                        开始答题
                      </Button>
                    )}
                    {record.status === 'completed' && (
                      <Tag color="success">已完成</Tag>
                    )}
                  </Space>
                )}
              ]}
              rowKey="assignment_id"
              pagination={{ pageSize: 8 }}
            />
          )}
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <Title level={4} style={{ margin: 0 }}>
              <FileTextOutlined /> {currentExamPaper.title}
            </Title>
            <Button type="default" onClick={() => setCurrentExamPaper(null)}>
              返回试卷列表
            </Button>
          </div>

          <div style={{ marginBottom: 16, padding: 12, background: '#fffbe6', borderLeft: '4px solid #faad14' }}>
            <div style={{ display: 'flex', gap: 24 }}>
              <span>总题数：{currentExamPaper.total_questions} 题</span>
              <span>已答：{Object.values(examAnswers).filter(a => a.trim()).length} 题</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {currentExamPaper.questions.map((question, index) => (
              <Card 
                key={question.id} 
                title={`第 ${index + 1} 题 - ${question.category}`}
                extra={<Tag color="purple">{question.difficulty}</Tag>}
              >
                <div style={{ marginBottom: 16, padding: 12, background: '#f5f7fa', borderRadius: 8 }}>
                  <div style={{ fontWeight: 'bold', marginBottom: 8 }}>【场景描述】</div>
                  <div>{question.scenario}</div>
                </div>
                {question.key_points && question.key_points.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontWeight: 'bold', marginBottom: 8 }}>【得分踩分点】</div>
                    <Space wrap>
                      {question.key_points.map((point, i) => (
                        <Tag key={i}>{point}</Tag>
                      ))}
                    </Space>
                  </div>
                )}
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: 8 }}>【请写出您的回复话术】</div>
                  <TextArea
                    rows={6}
                    placeholder="请输入您的回答..."
                    value={examAnswers[question.id] || ''}
                    onChange={(e) => handleExamAnswerChange(question.id, e.target.value)}
                  />
                </div>
              </Card>
            ))}
          </div>

          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center', gap: 16 }}>
            <Button type="default" onClick={() => setCurrentExamPaper(null)}>
              返回试卷列表
            </Button>
            <Button 
              type="primary" 
              loading={examSubmitLoading}
              onClick={() => {
                const assignment = examPapers.find(p => p.paper_id === currentExamPaper.id)
                if (assignment) submitExam(assignment.assignment_id)
              }}
            >
              {examSubmitLoading ? 'AI评分中，请耐心等待...' : '提交试卷'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )

  const renderStudyHall = () => (
    <div style={{ position: 'relative', minHeight: '500px', background: '#f8f9fa', padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}><BookOutlined /> 银行业务知识库</Title>
        <div style={{ display: 'flex', alignItems: 'center', background: '#fff', padding: '8px 16px', borderRadius: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <ClockCircleOutlined style={{ fontSize: 20, color: isPomodoroRunning ? '#52c41a' : '#1d39c4', marginRight: 12 }} />
          <Statistic value={formatTime(pomodoroTime)} styles={{ content: { fontSize: 20, fontWeight: 'bold', color: isPomodoroRunning ? '#52c41a' : '#333' } }} />
          <Button 
            type={isPomodoroRunning ? "default" : "primary"} 
            size="small" 
            onClick={togglePomodoro}
            style={{ marginLeft: 16, borderRadius: 16 }}
          >
            {isPomodoroRunning ? '暂停专注' : (pomodoroTime === 25 * 60 ? '开始专注' : '继续专注')}
          </Button>
        </div>
      </div>
      
      {/* 模拟的知识库文档列表 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
        {['密码重置与找回', '账户受控排查', '信用卡挂失与补办', '客户预留信息更新', '远程银行首登有礼'].map(topic => (
          <Card 
            key={topic} 
            hoverable 
            style={{ borderRadius: 8 }}
            onClick={() => {
              setCurrentDocTopic(topic)
              setDocDrawerVisible(true)
            }}
          >
            <Card.Meta title={topic} description="包含标准话术与 RAG 知识点。点击进行深度阅读与学习。" />
          </Card>
        ))}
      </div>

      {/* 费曼完成度追踪 */}
      {feynmanProgress && (
        <Card style={{ marginTop: 24 }} title={<Space><TrophyOutlined /> 费曼学习进度</Space>}>
          <Row gutter={16}>
            <Col span={6}>
              <Statistic title="已学知识点" value={feynmanProgress.total_topics} />
            </Col>
            <Col span={6}>
              <Statistic title="已掌握(≥70分)" value={feynmanProgress.completed} styles={{ content: { color: '#52c41a' } }} />
            </Col>
            <Col span={6}>
              <Statistic title="完成率" value={Math.round(feynmanProgress.completion_rate * 100)} suffix="%" />
            </Col>
            <Col span={6}>
              <Button type="primary" icon={<AimOutlined />} onClick={() => { setFeynmanModalVisible(true); setFeynmanResult(null); setFeynmanParaphrase(''); }}>
                费曼复述
              </Button>
            </Col>
          </Row>
          {feynmanProgress.topics && feynmanProgress.topics.length > 0 && (
            <div style={{ marginTop: 16 }}>
              {feynmanProgress.topics.map((t, idx) => (
                <Tag key={idx} color={t.score >= 70 ? 'success' : 'warning'} style={{ marginBottom: 4 }}>
                  {t.topic}: {t.score}分
                </Tag>
              ))}
            </div>
          )}
        </Card>
      )}

      {pomodoroStats && (
        <Card style={{ marginTop: 16 }} title={<Space><FireOutlined /> 学习节奏统计</Space>}>
          <Row gutter={16}>
            <Col span={6}><Statistic title="总番茄数" value={pomodoroStats.total_pomodoros} /></Col>
            <Col span={6}><Statistic title="累计学习时长" value={pomodoroStats.total_study_hours} suffix="小时" /></Col>
            <Col span={6}><Statistic title="连续学习天数" value={pomodoroStats.streak_days} suffix="天" styles={{ content: { color: '#fa541c' } }} /></Col>
            <Col span={6}><Statistic title="日均番茄数" value={pomodoroStats.avg_daily_pomodoros} /></Col>
          </Row>
        </Card>
      )}

      {/* 文档详情抽屉 */}
      <Drawer
        title={<Space><BookOutlined /> {currentDocTopic}</Space>}
        placement="left"
        size="large"
        onClose={() => setDocDrawerVisible(false)}
        open={docDrawerVisible}
      >
        <div className="markdown-body" style={{ background: '#fff', padding: '16px', borderRadius: '8px' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {docContents[currentDocTopic] || '暂无内容'}
          </ReactMarkdown>
        </div>
      </Drawer>

      {/* 悬浮窗唤醒 AI 导师 */}
      <FloatButton 
        icon={<RobotOutlined />} 
        type="primary" 
        style={{ right: 24, bottom: 24, width: 56, height: 56 }} 
        tooltip="呼叫 AI 导师"
        onClick={() => setAiTutorVisible(true)}
      />

      {/* AI 导师抽屉 */}
      <Drawer
        title={<Space><RobotOutlined /> 伴随式 AI 导师 (Doc Agent)</Space>}
        placement="right"
        size="large"
        onClose={() => setAiTutorVisible(false)}
        open={aiTutorVisible}
        styles={{ body: { padding: 0 } }}
      >
        {renderChatBox('请问在阅读业务文档时遇到了什么疑问？', false, true)}
      </Drawer>
    </div>
  )

  const items = [
    {
      key: 'study',
      label: '学习中心 (Doc Agent)',
      children: renderStudyHall(),
    },
    {
      key: 'practice',
      label: (
        <span>
          练习中心 (Quiz Agent)
          {recommendation && recommendation.has_recommendation && (
            <Badge count={recommendation.recommendations.length} size="small" style={{ marginLeft: 4 }} />
          )}
        </span>
      ),
      children: activeTab === 'practice' && !selectedPracticeQuestion ? renderPracticeSelection() : renderChatBox('请输入您的回复话术...'),
    },
    {
      key: 'exam',
      label: '理论考试',
      children: renderExamCenter(),
    },
    {
      key: 'persona-exam',
      label: '情景模拟 (Persona Agent)',
      children: renderChatBox('模拟客户已连接，请准备好接待...', true),
    }
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>考生大厅</Title>
        <Space>
          <Button
            type="default"
            icon={<RiseOutlined />}
            onClick={() => { loadCapabilityPortrait(); setPortraitModalVisible(true) }}
          >
            我的能力画像
          </Button>
          <Button
            type="default"
            icon={<HistoryOutlined />}
            onClick={loadHistory}
            loading={historyLoading}
          >
            查看历史记录
          </Button>
        </Space>
      </div>
      
      <Card>
        <Tabs activeKey={activeTab} onChange={handleTabChange} items={items} />
      </Card>

      <Modal
        title="情景模拟评分报告"
        open={reportModalVisible}
        onOk={() => {
          setReportModalVisible(false)
          setChatHistory([]) // 考完清空
        }}
        onCancel={() => setReportModalVisible(false)}
        width={700}
      >
        {scoreReport && (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <Progress 
                  type="dashboard" 
                  percent={scoreReport.overall_score || 0} 
                  strokeColor={scoreReport.overall_score >= 80 ? '#52c41a' : (scoreReport.overall_score >= 60 ? '#faad14' : '#f5222d')}
                />
                <Title level={4} style={{ marginTop: 16 }}>综合得分</Title>
              </div>
              <div style={{ width: '400px' }}>
                {renderRadarChart(scoreReport.score_details)}
              </div>
            </div>
            
            <Descriptions title="五维得分明细" bordered column={2}>
              <Descriptions.Item label="业务准确性">{scoreReport.score_details?.accuracy || 0} 分</Descriptions.Item>
              <Descriptions.Item label="服务态度">{scoreReport.score_details?.service_tone || 0} 分</Descriptions.Item>
              <Descriptions.Item label="制度合规性">{scoreReport.score_details?.compliance || 0} 分</Descriptions.Item>
              <Descriptions.Item label="情绪安抚">{scoreReport.score_details?.empathy || 0} 分</Descriptions.Item>
              <Descriptions.Item label="沟通控场">{scoreReport.score_details?.dialogue_control || 0} 分</Descriptions.Item>
            </Descriptions>

            <div>
              <Title level={5}>AI 综合评价与建议</Title>
              <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 8, whiteSpace: 'pre-wrap' }}>
                {scoreReport.feedback}
              </div>
            </div>
          </Space>
        )}
      </Modal>

      <Drawer
        title="我的记录"
        placement="right"
        size="large"
        onClose={() => {
          setHistoryDrawerVisible(false)
          setSelectedHistoryChats([])
          setSelectedHistoryRecord(null)
        }}
        open={historyDrawerVisible}
      >
        <Tabs activeKey={historyTab} onChange={setHistoryTab} items={[
          {
            key: 'exam',
            label: '情景模拟记录',
            children: (
              !selectedHistoryChats.length ? (
                <List
                  itemLayout="horizontal"
                  dataSource={historyList}
                  renderItem={item => (
                    <List.Item
                      actions={[
                        <Button type="link" onClick={() => loadChatDetails(item)}>查看报告与对话</Button>
                      ]}
                    >
                      <List.Item.Meta
                        title={<span>考试时间: {item.created_at ? new Date(item.created_at).toLocaleString() : '未知'}</span>}
                        description={
                          <div style={{ marginTop: 8 }}>
                            <Space size="middle" style={{ marginBottom: 12 }}>
                              <Tag color={item.overall_score >= 80 ? 'success' : (item.overall_score >= 60 ? 'warning' : 'error')}>
                                综合得分: {item.overall_score || 0}
                              </Tag>
                              <Tag>准确性: {item.score_details?.accuracy || 0}</Tag>
                              <Tag>服务态度: {item.score_details?.service_tone || 0}</Tag>
                            </Space>
                            <div style={{ padding: '8px 12px', background: '#f5f5f5', borderRadius: 4, color: '#666', borderLeft: '3px solid #1d39c4' }}>
                              <Typography.Text type="secondary" ellipsis={{ tooltip: item.feedback }} style={{ width: '100%' }}>
                                {item.feedback || '暂无评语'}
                              </Typography.Text>
                            </div>
                          </div>
                        }
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <div>
                  <Button 
                    type="link" 
                    icon={<HistoryOutlined />}
                    style={{ marginBottom: 16, padding: 0 }} 
                    onClick={() => {
                      setSelectedHistoryChats([])
                      setSelectedHistoryRecord(null)
                    }}
                  >
                    返回记录列表
                  </Button>

                  {selectedHistoryRecord && (
                    <div style={{ marginBottom: 24 }}>
                      <Title level={5}>评分报告</Title>
                      <Card size="small" bordered style={{ background: '#fafafa' }}>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <div style={{ textAlign: 'center', width: '120px' }}>
                            <Progress 
                              type="dashboard" 
                              size={80}
                              percent={selectedHistoryRecord.overall_score || 0} 
                              strokeColor={selectedHistoryRecord.overall_score >= 80 ? '#52c41a' : (selectedHistoryRecord.overall_score >= 60 ? '#faad14' : '#f5222d')}
                            />
                            <div style={{ fontWeight: 'bold', marginTop: 8 }}>综合得分</div>
                          </div>
                          <div style={{ flex: 1 }}>
                            {renderRadarChart(selectedHistoryRecord.score_details)}
                          </div>
                        </div>
                        <Divider style={{ margin: '12px 0' }} />
                        <div style={{ fontSize: 13, color: '#666', whiteSpace: 'pre-wrap' }}>
                          <strong>AI 评语：</strong>
                          {selectedHistoryRecord.feedback}
                        </div>
                      </Card>
                    </div>
                  )}

                  <Title level={5}>对话回放</Title>
                  <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
                    {selectedHistoryChats.map((chat, idx) => (
                      <div key={idx} style={{ marginBottom: 12 }}>
                        <strong style={{ color: chat.role === 'trainee' ? '#1d39c4' : '#333' }}>
                          {chat.role === 'trainee' ? '我' : '客户'}:
                        </strong>
                        <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{chat.content}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            )
          },
          {
            key: 'practice',
            label: '专项练习记录',
            children: (
              <>
                <Table
                  dataSource={practiceHistoryList}
                  rowKey={(item, idx) => idx}
                  size="small"
                  pagination={{ pageSize: 10 }}
                  columns={[
                    { title: '练习时间', key: 'time', width: 160, render: (_, item) => item.created_at ? new Date(item.created_at).toLocaleString() : '-' },
                    { title: '题目场景', key: 'scenario', ellipsis: true, render: (_, item) => item.question_scenario?.substring(0, 50) + '...' },
                    { title: '我的回答', key: 'answer', width: 120, ellipsis: true, render: (_, item) => item.trainee_answer?.substring(0, 30) + '...' },
                    { title: '操作', key: 'action', width: 90, render: (_, item) => (
                      <Button size="small" type="link" onClick={() => { setCurrentPracticeDetail(item); setPracticeDetailVisible(true) }}>查看详情</Button>
                    ) }
                  ]}
                  locale={{ emptyText: '暂无练习记录' }}
                />
                <Modal
                  title="练习记录详情"
                  open={practiceDetailVisible}
                  onCancel={() => setPracticeDetailVisible(false)}
                  footer={[<Button key="close" onClick={() => setPracticeDetailVisible(false)}>关闭</Button>]}
                  width={700}
                >
                  {currentPracticeDetail && (
                    <div>
                      <div style={{ marginBottom: 8, color: '#999', fontSize: 12 }}>
                        练习时间: {currentPracticeDetail.created_at ? new Date(currentPracticeDetail.created_at).toLocaleString() : '未知'}
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <strong>题目场景：</strong>
                        <div style={{ marginTop: 4, color: '#666' }}>{currentPracticeDetail.question_scenario}</div>
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <strong style={{ color: '#1d39c4' }}>我的回答：</strong>
                        <div style={{ marginTop: 4, padding: '8px 12px', background: '#f5f5f5', borderRadius: 4, whiteSpace: 'pre-wrap' }}>
                          {currentPracticeDetail.trainee_answer}
                        </div>
                      </div>
                      <div>
                        <strong style={{ color: '#52c41a' }}>AI 点评：</strong>
                        <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', fontSize: 13, color: '#333', padding: '8px 12px', background: '#f6ffed', borderRadius: 4, border: '1px solid #b7eb8f' }}>
                          {currentPracticeDetail.ai_evaluation?.replace('【练习判分结果】\n', '')}
                        </div>
                      </div>
                    </div>
                  )}
                </Modal>
              </>
            )
          },
          {
            key: 'trend',
            label: '成绩趋势分析',
            children: trendData ? (
              <div>
                <Title level={5}>考试成绩趋势</Title>
                {trendData.exam_trend && trendData.exam_trend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={trendData.exam_trend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="score" name="考试得分" stroke="#1d39c4" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <Empty description="暂无考试数据" />}

                <Title level={5} style={{ marginTop: 24 }}>练习成绩趋势</Title>
                {trendData.practice_trend && trendData.practice_trend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={trendData.practice_trend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="score" name="练习得分" stroke="#52c41a" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <Empty description="暂无练习数据" />}

                <Row gutter={16} style={{ marginTop: 16 }}>
                  <Col span={6}><Statistic title="考试次数" value={trendData.exam_count} /></Col>
                  <Col span={6}><Statistic title="考试平均分" value={Math.round(trendData.exam_avg)} /></Col>
                  <Col span={6}><Statistic title="练习次数" value={trendData.practice_count} /></Col>
                  <Col span={6}><Statistic title="练习平均分" value={Math.round(trendData.practice_avg)} /></Col>
                </Row>
              </div>
            ) : <Spin />
          }
        ]} />
      </Drawer>

      <Modal
        title="费曼复述挑战"
        open={feynmanModalVisible}
        onCancel={() => setFeynmanModalVisible(false)}
        footer={feynmanResult ? [
          <Button key="close" onClick={() => setFeynmanModalVisible(false)}>关闭</Button>
        ] : [
          <Button key="cancel" onClick={() => setFeynmanModalVisible(false)}>取消</Button>,
          <Button key="submit" type="primary" loading={feynmanSubmitting} onClick={submitFeynman}>提交复述</Button>
        ]}
        width={600}
      >
        {!feynmanResult ? (
          <div>
            <Alert message="用自己的话解释一个知识点，系统将评估你的理解度" type="info" showIcon style={{ marginBottom: 16 }} />
            <Input placeholder="知识点主题（如：密码重置流程）" value={feynmanTopic} onChange={e => setFeynmanTopic(e.target.value)} style={{ marginBottom: 12 }} />
            <TextArea rows={6} placeholder="请用自己的话复述这个知识点的核心内容..." value={feynmanParaphrase} onChange={e => setFeynmanParaphrase(e.target.value)} />
          </div>
        ) : (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <Progress type="dashboard" percent={feynmanResult.understanding_score}
                strokeColor={feynmanResult.understanding_score >= 70 ? '#52c41a' : '#faad14'} />
              <Title level={4}>理解度评分</Title>
            </div>
            <Descriptions bordered column={1}>
              <Descriptions.Item label="核心概念准确">{feynmanResult.is_accurate ? '✅ 是' : '❌ 否'}</Descriptions.Item>
              {feynmanResult.missing_points && feynmanResult.missing_points.length > 0 && (
                <Descriptions.Item label="遗漏的关键点">
                  {feynmanResult.missing_points.map((p, i) => <Tag key={i} color="orange">{p}</Tag>)}
                </Descriptions.Item>
              )}
              <Descriptions.Item label="复习建议">{feynmanResult.review_suggestion}</Descriptions.Item>
            </Descriptions>
          </div>
        )}
      </Modal>

      <Modal
        title="多维能力画像"
        open={portraitModalVisible}
        onCancel={() => setPortraitModalVisible(false)}
        footer={[<Button key="close" onClick={() => setPortraitModalVisible(false)}>关闭</Button>]}
        width={700}
      >
        {capabilityPortrait ? (
          <div>
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={[
                  { subject: '知识掌握度', A: capabilityPortrait.overall_portrait?.knowledge_mastery || 0, fullMark: 100 },
                  { subject: '学习节奏感', A: capabilityPortrait.overall_portrait?.learning_rhythm || 0, fullMark: 100 },
                  { subject: '实战能力', A: capabilityPortrait.overall_portrait?.practical_ability || 0, fullMark: 100 },
                  { subject: '错误修正力', A: capabilityPortrait.overall_portrait?.error_correction || 0, fullMark: 100 },
                ]}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#333', fontSize: 13 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} />
                  <Radar name="能力" dataKey="A" stroke="#1d39c4" fill="#1d39c4" fillOpacity={0.5} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <Row gutter={16} style={{ marginTop: 24 }}>
              <Col span={12}>
                <Card size="small" title="知识掌握度">
                  <Statistic value={capabilityPortrait.knowledge_mastery?.score || 0} suffix="/100" />
                  <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                    费曼完成度: {Math.round((capabilityPortrait.knowledge_mastery?.feynman_completion || 0) * 100)}%
                    <br />练习平均分: {capabilityPortrait.knowledge_mastery?.practice_avg_score || 0}
                  </div>
                </Card>
              </Col>
              <Col span={12}>
                <Card size="small" title="学习节奏感">
                  <Statistic value={capabilityPortrait.learning_rhythm?.score || 0} suffix="/100" />
                  <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                    总番茄数: {capabilityPortrait.learning_rhythm?.total_pomodoros || 0}
                    <br />连续天数: {capabilityPortrait.learning_rhythm?.streak_days || 0}
                  </div>
                </Card>
              </Col>
              <Col span={12} style={{ marginTop: 16 }}>
                <Card size="small" title="实战能力">
                  <Statistic value={capabilityPortrait.practical_ability?.score || 0} suffix="/100" />
                  <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                    考试次数: {capabilityPortrait.practical_ability?.exam_count || 0}
                    <br />考试平均分: {capabilityPortrait.practical_ability?.exam_avg_score || 0}
                  </div>
                </Card>
              </Col>
              <Col span={12} style={{ marginTop: 16 }}>
                <Card size="small" title="错误修正力">
                  <Statistic value={capabilityPortrait.error_correction?.score || 0} suffix="/100" />
                  <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                    已解决弱点: {capabilityPortrait.error_correction?.resolved_weaknesses || 0}/{capabilityPortrait.error_correction?.total_weaknesses || 0}
                    <br />解决率: {Math.round((capabilityPortrait.error_correction?.resolution_rate || 0) * 100)}%
                  </div>
                </Card>
              </Col>
            </Row>
          </div>
        ) : <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>}
      </Modal>

      <Modal
        title="反循环验证结果"
        open={verifyModalVisible}
        onCancel={() => setVerifyModalVisible(false)}
        footer={[<Button key="close" onClick={() => setVerifyModalVisible(false)}>关闭</Button>]}
        width={500}
      >
        {verifyResult && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <Tag color={verifyResult.status === 'corrected' ? 'success' : 'error'} style={{ fontSize: 16, padding: '4px 16px' }}>
                {verifyResult.status === 'corrected' ? '✅ 已修正' : '❌ 需要强化学习'}
              </Tag>
            </div>
            <Descriptions bordered column={1}>
              <Descriptions.Item label="得分">{verifyResult.score}/100</Descriptions.Item>
              {verifyResult.covered_points && verifyResult.covered_points.length > 0 && (
                <Descriptions.Item label="已掌握的点">
                  {verifyResult.covered_points.map((p, i) => <Tag key={i} color="success">{p}</Tag>)}
                </Descriptions.Item>
              )}
              {verifyResult.still_missing && verifyResult.still_missing.length > 0 && (
                <Descriptions.Item label="仍未掌握的点">
                  {verifyResult.still_missing.map((p, i) => <Tag key={i} color="error">{p}</Tag>)}
                </Descriptions.Item>
              )}
              <Descriptions.Item label="评价">{verifyResult.feedback}</Descriptions.Item>
              {verifyResult.recommendation && (
                <Descriptions.Item label="复习建议">{verifyResult.recommendation}</Descriptions.Item>
              )}
            </Descriptions>
            {verifyResult.status === 'corrected' && (
              <Alert message="恭喜！薄弱知识点已标记为解决！" type="success" showIcon style={{ marginTop: 16 }} />
            )}
          </div>
        )}
      </Modal>

      <Modal
        title="试卷提交结果"
        open={examResultVisible}
        onCancel={() => { setExamResultVisible(false); setCurrentExamPaper(null); }}
        footer={[<Button key="close" onClick={() => { setExamResultVisible(false); setCurrentExamPaper(null); }}>关闭</Button>]}
        width={700}
      >
        {examResult && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <Progress 
                type="dashboard" 
                percent={examResult.total_score || 0} 
                strokeColor={examResult.total_score >= 80 ? '#52c41a' : (examResult.total_score >= 60 ? '#faad14' : '#f5222d')}
                style={{ width: 120, height: 120 }}
              />
              <Title level={4} style={{ marginTop: 16 }}>总得分：{examResult.total_score} 分</Title>
              <Alert message={examResult.message} type="success" showIcon style={{ marginTop: 12 }} />
            </div>

            <Title level={5}>各题得分详情</Title>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {examResult.question_results && examResult.question_results.map((result, index) => (
                <Card size="small" key={index} title={`第 ${index + 1} 题`}>
                  <Row gutter={16}>
                    <Col span={8}>
                      <Statistic title="得分" value={result.score} suffix="/100" />
                    </Col>
                    <Col span={16}>
                      {result.missed_points && result.missed_points.length > 0 && (
                        <div>
                          <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>遗漏的踩分点：</div>
                          <Space wrap>
                            {result.missed_points.map((p, i) => <Tag key={i} color="orange">{p}</Tag>)}
                          </Space>
                        </div>
                      )}
                    </Col>
                  </Row>
                  {result.feedback && (
                    <div style={{ marginTop: 8, padding: 8, background: '#f5f7fa', borderRadius: 4, fontSize: 12 }}>
                      {result.feedback}
                    </div>
                  )}
                </Card>
              ))}
            </div>

            {examResult.question_results && examResult.question_results.some(r => r.score < 80) && (
              <Alert 
                message="部分题目得分较低，系统已自动记录薄弱点，建议进行反向训练" 
                type="warning" 
                showIcon 
                style={{ marginTop: 16 }} 
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

export default TraineePortal
