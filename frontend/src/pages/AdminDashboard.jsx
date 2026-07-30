import React, { useState, useEffect, useRef } from 'react'
import { Graph as G6Graph } from '@antv/g6'
import { Typography, Card, Tabs, Table, Button, Space, Modal, Form, Input, App, Popconfirm, Tag, Upload, Statistic, Row, Col, Select, Drawer, Divider, Checkbox } from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, UploadOutlined, DashboardOutlined, FileTextOutlined,
  WarningOutlined, ThunderboltOutlined, ArrowLeftOutlined, UserOutlined, ProjectOutlined, ApiOutlined,
  OrderedListOutlined, DatabaseOutlined
} from '@ant-design/icons'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts'
import axios from 'axios'
import { API_BASE } from './admin/constants'
import KeyPointStatsTab from './admin/KeyPointStatsTab'
import ProjectScenariosTab from './admin/ProjectScenariosTab'
import CozeWorkflowRegistryTab from './admin/CozeWorkflowRegistryTab'
import PracticeNodeQuestionsTab from './admin/PracticeNodeQuestionsTab'
import PracticeQuestionDraftsTab from './admin/PracticeQuestionDraftsTab'

const { Title } = Typography
const { TextArea } = Input

// 配置大厅首页的模块分组：点进去才跳转到具体模块的独立页面，而不是把十几个功能全部平铺成一排 Tabs
const MODULE_GROUPS = [
  {
    title: '培训内容配置',
    modules: [
      { key: 'personas', label: '客户人格配置 (Persona)', icon: <UserOutlined />, desc: '配置模拟客户的性格、情绪基线与话术风格' },
      { key: 'questions', label: '练习题库管理 (Quiz)', icon: <FileTextOutlined />, desc: '管理经典题库的场景、参考答案与得分点' },
      { key: 'projects', label: '项目场景配置 (PBL)', icon: <ProjectOutlined />, desc: '配置多任务流程的项目制考试场景' },
    ]
  },
  {
    title: '情景陪练 · Coze 工作流',
    modules: [
      { key: 'coze-workflows', label: 'Coze 工作流注册', icon: <ApiOutlined />, desc: '维护业务线与 Coze workflow_id 的对应关系' },
      { key: 'practice-nodes', label: '情景陪练题目管理', icon: <OrderedListOutlined />, desc: '维护各业务线陪练题目镜像表与同步状态' },
      { key: 'practice-drafts', label: '陪练题目 AI 起草', icon: <ThunderboltOutlined />, desc: 'AI 起草陪练题目草稿，人工审核后入库' },
    ]
  },
  {
    title: '知识库与教研',
    modules: [
      { key: 'builder', label: '自动化教研 (Auto-Builder)', icon: <UploadOutlined />, desc: '上传业务文档，AI 自动提取知识点' },
      { key: 'kb-manage', label: '知识库管理', icon: <DatabaseOutlined />, desc: '管理知识库节点、业务线归类与知识图谱' },
    ]
  },
  {
    title: '数据与分析',
    modules: [
      { key: 'dashboard', label: '数据大屏', icon: <DashboardOutlined />, desc: '全局学员表现、易错点与分类统计' },
      { key: 'key-point-stats', label: '群体薄弱知识点', icon: <WarningOutlined />, desc: '统计全员得分点命中率，驱动知识库自动补强' },
      { key: 'weaknesses', label: '学员错题画像', icon: <WarningOutlined />, desc: '查看全体学员的弱点标签与得分明细' },
    ]
  },
  {
    title: '组卷与发卷',
    modules: [
      { key: 'papers', label: '组卷发卷', icon: <FileTextOutlined />, desc: '组建试卷、下发给学员、查看做题记录' },
    ]
  },
]

// AI 人格生成器的标签快选：点标签拼描述，不用手动打字也能生成人格
const PERSONA_TAG_GROUPS = [
  { group: '身份年龄', tags: ['年轻人', '中年人', '老年人', '学生'] },
  { group: '性格情绪', tags: ['急躁易怒', '平和耐心', '多疑警惕', '唠叨啰嗦', '沉默寡言', '情绪激动带哭腔'] },
  { group: '表达障碍', tags: ['耳背听不清', '方言口音重', '不熟悉手机操作', '看不懂短信通知'] },
  { group: '来电诉求', tags: ['密码重置', '信用卡挂失', '账户冻结解冻', '转账失败', '余额疑问', '开卡咨询'] },
  { group: '特殊状况', tags: ['要投诉', '威胁曝光媒体', '赶时间很急', '反复确认不放心'] },
]

const AdminDashboard = () => {
  const { message } = App.useApp()
  const [activeTab, setActiveTab] = useState(null)
  const [loading, setLoading] = useState(false)
  
  // State for Personas
  const [personas, setPersonas] = useState([])
  const [isPersonaModalVisible, setIsPersonaModalVisible] = useState(false)
  const [editingPersona, setEditingPersona] = useState(null)
  const [personaForm] = Form.useForm()
  const [personaGeneratorVisible, setPersonaGeneratorVisible] = useState(false)
  const [selectedPersonaTags, setSelectedPersonaTags] = useState([])
  const [personaExtraNote, setPersonaExtraNote] = useState('')
  const [generatingPersona, setGeneratingPersona] = useState(false)
  const [generatedPersona, setGeneratedPersona] = useState(null)

  // State for Questions
  const [questions, setQuestions] = useState([])
  const [isQuestionModalVisible, setIsQuestionModalVisible] = useState(false)
  const [editingQuestion, setEditingQuestion] = useState(null)
  const [questionForm] = Form.useForm()

  // State for KB Node Search（关联知识库节点）
  const [kbNodeOptions, setKbNodeOptions] = useState([])
  const [kbSearching, setKbSearching] = useState(false)

  const handleSearchKbNodes = async (value) => {
    if (!value) return
    setKbSearching(true)
    try {
      const res = await axios.get(`${API_BASE}/kb-nodes/search`, { params: { q: value } })
      setKbNodeOptions(res.data.map(n => ({
        label: `[${n.business_line || '未分类'}] ${n.content.substring(0, 50)}...`,
        value: n.node_id
      })))
    } catch (err) {
      console.error('搜索知识库节点失败', err)
    } finally {
      setKbSearching(false)
    }
  }

  const handleSelectKbNode = async (nodeId) => {
    if (!nodeId) {
      questionForm.setFieldsValue({ source_node_id: undefined })
      return
    }
    // 选中节点后，获取节点业务线自动填充分类
    try {
      const res = await axios.get(`${API_BASE}/kb-nodes/search`, { params: { q: '' } })
      const node = res.data.find(n => n.node_id === nodeId)
      if (node && node.business_line) {
        questionForm.setFieldsValue({ category: node.business_line })
        message.info(`已自动设置分类为：${node.business_line}`)
      }
    } catch (err) {
      // 静默失败
    }
  }

  // State for Auto-Builder
  const [docText, setDocText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extractedNodes, setExtractedNodes] = useState([])
  const [savingNodes, setSavingNodes] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('全部')

  // State for Dashboard
  const [dashboardStats, setDashboardStats] = useState(null)

  // State for Trainee Profiles (学员画像)
  const [profileTags, setProfileTags] = useState([])
  const [selectedProfileTag, setSelectedProfileTag] = useState(null)
  const [profileList, setProfileList] = useState([])
  const [loadingProfiles, setLoadingProfiles] = useState(false)

  // State for Exam Papers
  const [examPapers, setExamPapers] = useState([])
  const [isPaperModalVisible, setIsPaperModalVisible] = useState(false)
  const [paperForm] = Form.useForm()
  const [distributeModalVisible, setDistributeModalVisible] = useState(false)
  const [distributingPaper, setDistributingPaper] = useState(null)
  const [allTrainees, setAllTrainees] = useState([])
  const [selectedTrainees, setSelectedTrainees] = useState([])
  const [paperAssignments, setPaperAssignments] = useState([])
  const [assignmentDrawerVisible, setAssignmentDrawerVisible] = useState(false)

  // State for Paper Records (做题记录详情)
  const [paperRecordsVisible, setPaperRecordsVisible] = useState(false)
  const [paperRecords, setPaperRecords] = useState([])
  const [answerDetailVisible, setAnswerDetailVisible] = useState(false)
  const [currentAnswerDetail, setCurrentAnswerDetail] = useState(null)
  const [currentPaperId, setCurrentPaperId] = useState(null)
  const [loadingRecords, setLoadingRecords] = useState(false)

  // State for Weakness Overview
  const [allWeaknesses, setAllWeaknesses] = useState([])

  // State for Prewarm (业务线分类预热)
  const [prewarmStatus, setPrewarmStatus] = useState({ status: 'pending' })
  const [prewarming, setPrewarming] = useState(false)

  // 知识库管理状态
  const [kbNodes, setKbNodes] = useState({ nodes: [], grouped: {}, stats: [], total: 0 })
  const [kbLoading, setKbLoading] = useState(false)
  const [selectedBusinessLine, setSelectedBusinessLine] = useState(null)
  const [kbSearchText, setKbSearchText] = useState('')
  const [classifying, setClassifying] = useState(false)
  const [newBlModalVisible, setNewBlModalVisible] = useState(false)
  const [newBlForm] = Form.useForm()
  const [selectedNodeIds, setSelectedNodeIds] = useState([])
  const [editingNodeBl, setEditingNodeBl] = useState(null) // {node_id, business_line}
  const [kbRelations, setKbRelations] = useState([])
  const [relationModalVisible, setRelationModalVisible] = useState(false)
  const [buildingGraph, setBuildingGraph] = useState(false)
  const [relationForm] = Form.useForm()
  const [graphVisible, setGraphVisible] = useState(false)
  const [graphData, setGraphData] = useState({ nodes: [], edges: [] })
  const graphContainerRef = useRef(null)
  const graphInstanceRef = useRef(null)
  const [nodeDetailVisible, setNodeDetailVisible] = useState(false)
  const [nodeDetail, setNodeDetail] = useState(null)
  const [showIsolatedNodes, setShowIsolatedNodes] = useState(false)

  // 从节点原始 label（如"【客户问题】未成年人忘记银行卡密码怎么重..."）里提取一段简短、去掉方括号前缀的显示文本
  const shortNodeLabel = (label, id) => {
    const cleaned = (label || '').replace(/【[^】]*】/g, '').trim()
    const text = cleaned || id || ''
    return text.length > 8 ? text.slice(0, 8) + '…' : text
  }

  // 知识图谱可视化：graphVisible/graphData/showIsolatedNodes 变化时用 G6 渲染力导向图（拖拽、缩放、按业务线着色）
  useEffect(() => {
    if (!graphVisible || !graphContainerRef.current) return
    if (graphData.nodes.length === 0) return

    const MAX_NODES = 150
    const allNodeIds = new Set(graphData.nodes.slice(0, MAX_NODES).map(n => n.id))
    const validEdges = graphData.edges.filter(e => allNodeIds.has(e.source) && allNodeIds.has(e.target))

    // 默认只展示"有关联的节点"，避免大量孤立节点让图看起来杂乱；可通过开关展示全部
    const connectedIds = new Set(validEdges.flatMap(e => [e.source, e.target]))
    const visibleNodes = graphData.nodes
      .slice(0, MAX_NODES)
      .filter(n => showIsolatedNodes || connectedIds.has(n.id))

    const g6Data = {
      nodes: visibleNodes.map(n => ({
        id: n.id,
        data: { label: n.label || n.id, business_line: n.business_line || '未分类' }
      })),
      edges: validEdges.map((e, i) => ({
        id: `edge-${i}`,
        source: e.source,
        target: e.target,
        data: { relation_type: e.relation_type, weight: e.weight || 1 }
      }))
    }

    if (g6Data.nodes.length === 0) {
      graphContainerRef.current.innerHTML = ''
      return
    }

    const graph = new G6Graph({
      container: graphContainerRef.current,
      autoFit: 'view',
      data: g6Data,
      node: {
        style: {
          size: 24,
          labelText: (d) => shortNodeLabel(d.data.label, d.id),
          labelFontSize: 10,
          labelFill: '#333',
          labelBackground: true,
          labelBackgroundFill: '#fff',
          labelBackgroundOpacity: 0.75,
          labelPadding: [1, 3],
          labelMaxWidth: 80,
        },
        palette: { type: 'group', field: (d) => d.data.business_line },
      },
      edge: {
        style: {
          stroke: '#8c8c8c',
          lineWidth: (d) => Math.max(1, (d.data.weight || 1) * 2),
          lineDash: (d) => (d.data.relation_type === 'contradicts' ? [4, 2] : null),
          endArrow: false,
        },
      },
      layout: {
        type: 'force',
        preventOverlap: true,
        nodeSize: 32,
        linkDistance: 90,
      },
      behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element', 'hover-activate'],
      plugins: [
        {
          type: 'tooltip',
          getContent: (_e, items) => {
            const item = items?.[0]
            if (!item) return ''
            return `<div style="max-width:240px;font-size:12px;">
              <strong>${item.id}</strong>（${item.data.business_line}）<br/>${item.data.label}
            </div>`
          },
        },
      ],
    })
    graph.render()
    graphInstanceRef.current = graph

    return () => {
      graph.destroy()
      graphInstanceRef.current = null
    }
  }, [graphVisible, graphData, showIsolatedNodes])

  // 知识库管理函数
  const fetchKbNodes = async () => {
    setKbLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/kb-nodes`)
      setKbNodes(res.data)
    } catch (err) {
      message.error('加载知识库失败')
    } finally {
      setKbLoading(false)
    }
  }

  const handleKbSearch = async (value) => {
    setKbSearchText(value)
    if (!value) {
      fetchKbNodes()
      return
    }
    setKbLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/kb-nodes/search`, { params: { q: value } })
      // 搜索结果直接展示，不分组
      setKbNodes({ nodes: res.data, grouped: { '搜索结果': res.data }, stats: [{ business_line: '搜索结果', count: res.data.length }], total: res.data.length })
    } catch (err) {
      message.error('搜索失败')
    } finally {
      setKbLoading(false)
    }
  }

  const handleAutoClassify = async () => {
    setClassifying(true)
    try {
      const res = await axios.post(`${API_BASE}/kb-nodes/auto-classify`, {}, { timeout: 180000 })
      message.success(`智能归类完成：分类了 ${res.data.classified} 个节点（共 ${res.data.total_unclassified} 个未分类）`)
      fetchKbNodes()
    } catch (err) {
      message.error('智能归类失败: ' + err.message)
    } finally {
      setClassifying(false)
    }
  }

  const handleUpdateNodeBl = async (nodeId, businessLine) => {
    try {
      await axios.put(`${API_BASE}/kb-nodes/${nodeId}/business-line`, { business_line: businessLine })
      message.success('业务线已更新')
      setEditingNodeBl(null)
      fetchKbNodes()
    } catch (err) {
      message.error('更新失败')
    }
  }

  const handleDeleteKbNode = async (nodeId) => {
    try {
      await axios.delete(`${API_BASE}/kb-nodes/${nodeId}`)
      message.success('节点已删除')
      fetchKbNodes()
    } catch (err) {
      message.error('删除失败')
    }
  }

  const handleCreateBl = async (values) => {
    try {
      await axios.post(`${API_BASE}/business-lines`, {
        name: values.name,
        node_ids: selectedNodeIds
      })
      message.success(`业务线"${values.name}"创建成功，已归入 ${selectedNodeIds.length} 个节点`)
      setNewBlModalVisible(false)
      setSelectedNodeIds([])
      newBlForm.resetFields()
      fetchKbNodes()
    } catch (err) {
      message.error('创建失败')
    }
  }

  const fetchKbRelations = async () => {
    try {
      const res = await axios.get(`${API_BASE}/knowledge-relations`)
      setKbRelations(res.data)
    } catch (err) {
      console.error('加载关系失败', err)
    }
  }

  const fetchKnowledgeGraph = async () => {
    try {
      const res = await axios.get(`${API_BASE}/knowledge-graph`)
      setGraphData(res.data)
    } catch (err) {
      message.error('加载图谱失败')
    }
  }

  const handleCreateRelation = async (values) => {
    try {
      await axios.post(`${API_BASE}/knowledge-relations`, {
        source_node_id: values.source_node_id,
        target_node_id: values.target_node_id,
        relation_type: values.relation_type || 'related',
        weight: values.weight || 1.0
      })
      message.success('关系创建成功')
      setRelationModalVisible(false)
      relationForm.resetFields()
      fetchKbRelations()
      if (graphVisible) fetchKnowledgeGraph()
    } catch (err) {
      message.error('创建失败')
    }
  }

  const handleDeleteRelation = async (id) => {
    try {
      await axios.delete(`${API_BASE}/knowledge-relations/${id}`)
      message.success('关系已删除')
      fetchKbRelations()
      if (graphVisible) fetchKnowledgeGraph()
    } catch (err) {
      message.error('删除失败')
    }
  }

  const handleAutoBuildGraph = async () => {
    setBuildingGraph(true)
    try {
      const res = await axios.post(`${API_BASE}/knowledge-graph/auto-build`, {}, { timeout: 300000 })
      message.success(`智能构建完成：${res.data.business_lines} 个业务线，共 ${res.data.total_relations} 条关系`)
      fetchKbRelations()
      if (graphVisible) fetchKnowledgeGraph()
    } catch (err) {
      message.error('智能构建失败: ' + err.message)
    } finally {
      setBuildingGraph(false)
    }
  }

  const fetchPrewarmStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/prewarm/status`)
      setPrewarmStatus(res.data)
    } catch (e) {
      // 静默失败
    }
  }

  const handlePrewarm = async () => {
    setPrewarming(true)
    try {
      const res = await axios.post(`${API_BASE}/prewarm`)
      message.info(res.data.message || '预热已启动')
      // 轮询状态
      let pollCount = 0
      const poll = setInterval(async () => {
        pollCount++
        try {
          const sres = await axios.get(`${API_BASE}/prewarm/status`)
          const st = sres.data
          setPrewarmStatus(st)
          if (st.status === 'ready') {
            clearInterval(poll)
            setPrewarming(false)
            message.success(`业务线分类预热完成（共 ${st.business_lines?.length || 0} 条业务线）`)
          }
          // 5分钟超时（60次 * 5秒 = 300秒）
          if (pollCount >= 60) {
            clearInterval(poll)
            setPrewarming(false)
            message.warning('预热超时，请稍后重试')
          }
        } catch (e) {
          // 静默失败，继续轮询
        }
      }, 5000)
    } catch (e) {
      message.error('预热启动失败: ' + (e.response?.data?.detail || e.message))
      setPrewarming(false)
    }
  }

  useEffect(() => {
    fetchPrewarmStatus()
  }, [])

  useEffect(() => {
    if (activeTab === 'personas') fetchPersonas()
    else if (activeTab === 'questions') fetchQuestions()
    else if (activeTab === 'dashboard') {
      fetchDashboardStats()
      fetchProfileTags()
      fetchProfiles(null)
    }
    else if (activeTab === 'papers') fetchExamPapers()
    else if (activeTab === 'weaknesses') fetchAllWeaknesses()
  }, [activeTab])

  // --- Dashboard API ---
  const fetchDashboardStats = async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/dashboard/stats`)
      setDashboardStats(res.data)
    } catch (error) {
      message.error('获取数据大屏失败')
    }
    setLoading(false)
  }

  // --- Exam Paper API ---
  const fetchExamPapers = async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/exam-papers`)
      setExamPapers(res.data)
      // 同时获取题库供组卷选择
      if (questions.length === 0) fetchQuestions()
      // 获取学员列表
      const userRes = await axios.get(`${API_BASE}/personas`) // 暂用personas接口占位，后续应有/users接口
      setAllTrainees([{ id: 'mock_user', username: '测试用户' }])
    } catch (error) {
      message.error('获取试卷列表失败')
    }
    setLoading(false)
  }

  const handleCreatePaper = async (values) => {
    try {
      await axios.post(`${API_BASE}/exam-papers`, values)
      message.success('试卷创建成功')
      setIsPaperModalVisible(false)
      paperForm.resetFields()
      fetchExamPapers()
    } catch (error) {
      message.error('创建试卷失败')
    }
  }

  const handleDeletePaper = async (id) => {
    try {
      await axios.delete(`${API_BASE}/exam-papers/${id}`)
      message.success('删除成功')
      fetchExamPapers()
    } catch (error) {
      message.error('删除失败')
    }
  }

  const handleDistribute = async () => {
    try {
      await axios.post(`${API_BASE}/exam-papers/${distributingPaper.id}/distribute`, {
        trainee_ids: selectedTrainees
      })
      message.success(`已向${selectedTrainees.length}名学员下发试卷`)
      setDistributeModalVisible(false)
      setSelectedTrainees([])
    } catch (error) {
      message.error('发卷失败')
    }
  }

  const fetchPaperAssignments = async (paperId) => {
    try {
      const res = await axios.get(`${API_BASE}/exam-papers/${paperId}/assignments`)
      setPaperAssignments(res.data)
      setAssignmentDrawerVisible(true)
    } catch (error) {
      message.error('获取下发记录失败')
    }
  }

  const fetchPaperRecords = async (paperId) => {
    setCurrentPaperId(paperId)
    setLoadingRecords(true)
    setPaperRecordsVisible(true)
    try {
      const res = await axios.get(`${API_BASE}/exam-papers/${paperId}/records`)
      setPaperRecords(res.data)
    } catch (err) {
      message.error('加载做题记录失败')
    } finally {
      setLoadingRecords(false)
    }
  }

  const fetchProfileTags = async () => {
    try {
      const res = await axios.get(`${API_BASE}/trainee-profiles/tags`)
      setProfileTags(res.data)
    } catch (err) {
      console.error('加载标签失败', err)
    }
  }

  const fetchProfiles = async (tag) => {
    setLoadingProfiles(true)
    try {
      const res = await axios.get(`${API_BASE}/trainee-profiles`, { params: tag ? { tag } : {} })
      setProfileList(res.data)
    } catch (err) {
      console.error('加载画像失败', err)
    } finally {
      setLoadingProfiles(false)
    }
  }

  // --- Weakness Overview API ---
  const fetchAllWeaknesses = async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/weaknesses/overview`)
      setAllWeaknesses(res.data)
    } catch (error) {
      message.error('获取弱点概览失败')
    }
    setLoading(false)
  }

  // --- API Calls ---
  const fetchPersonas = async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/personas`)
      setPersonas(res.data)
    } catch (error) {
      message.error('获取人格配置失败')
    }
    setLoading(false)
  }

  const fetchQuestions = async () => {
    setLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/questions`)
      setQuestions(res.data)
    } catch (error) {
      message.error('获取题库失败')
    }
    setLoading(false)
  }

  // --- Persona Handlers ---
  const handleSavePersona = async (values) => {
    try {
      if (editingPersona) {
        await axios.put(`${API_BASE}/personas/${editingPersona.id}`, values)
        message.success('更新成功')
      } else {
        await axios.post(`${API_BASE}/personas`, values)
        message.success('创建成功')
      }
      setIsPersonaModalVisible(false)
      fetchPersonas()
    } catch (error) {
      message.error('保存失败')
    }
  }

  const handleDeletePersona = async (id) => {
    try {
      await axios.delete(`${API_BASE}/personas/${id}`)
      message.success('删除成功')
      fetchPersonas()
    } catch (error) {
      message.error('删除失败')
    }
  }

  const openPersonaModal = (record = null) => {
    setEditingPersona(record)
    if (record) {
      personaForm.setFieldsValue(record)
    } else {
      personaForm.resetFields()
    }
    setIsPersonaModalVisible(true)
  }

  const handleGeneratePersona = async () => {
    if (selectedPersonaTags.length === 0 && !personaExtraNote.trim()) {
      message.warning('请至少选择一个标签，或填写补充说明')
      return
    }
    const description = selectedPersonaTags.join('、') + (personaExtraNote.trim() ? `，${personaExtraNote.trim()}` : '')
    setGeneratingPersona(true)
    try {
      const res = await axios.post(`${API_BASE}/personas/generate`,
        { description },
        { timeout: 90000 }
      )
      if (res.data.status === 'success') {
        setGeneratedPersona(res.data.persona)
        message.success('人格生成成功，请预览并保存')
      } else {
        message.error('生成失败: ' + res.data.message)
      }
    } catch (err) {
      message.error('生成失败: ' + err.message)
    } finally {
      setGeneratingPersona(false)
    }
  }

  const handleSaveGeneratedPersona = async () => {
    if (!generatedPersona) return
    try {
      await axios.post(`${API_BASE}/personas`, {
        name: generatedPersona.name,
        description: generatedPersona.description,
        system_prompt: generatedPersona.system_prompt,
        initial_anxiety: generatedPersona.initial_anxiety,
        threshold: generatedPersona.threshold
      })
      message.success('人格保存成功')
      setPersonaGeneratorVisible(false)
      setGeneratedPersona(null)
      setSelectedPersonaTags([])
      setPersonaExtraNote('')
      fetchPersonas()
    } catch (err) {
      message.error('保存失败')
    }
  }

  // --- Question Handlers ---
  const handleSaveQuestion = async (values) => {
    try {
      // 简单处理 key_points，将逗号分隔的字符串转为数组
      const formattedValues = {
        ...values,
        key_points: values.key_points ? values.key_points.split('，').map(k => k.trim()) : [],
        source_node_id: values.source_node_id || null
      }
      
      if (editingQuestion) {
        await axios.put(`${API_BASE}/questions/${editingQuestion.id}`, formattedValues)
        message.success('更新成功')
      } else {
        await axios.post(`${API_BASE}/questions`, formattedValues)
        message.success('创建成功')
      }
      setIsQuestionModalVisible(false)
      fetchQuestions()
    } catch (error) {
      message.error('保存失败')
    }
  }

  const handleDeleteQuestion = async (id) => {
    try {
      await axios.delete(`${API_BASE}/questions/${id}`)
      message.success('删除成功')
      fetchQuestions()
    } catch (error) {
      message.error('删除失败')
    }
  }

  const openQuestionModal = (record = null) => {
    setEditingQuestion(record)
    if (record) {
      questionForm.setFieldsValue({
        ...record,
        key_points: record.key_points ? record.key_points.join('，') : '',
        source_node_id: record.source_node_id || undefined
      })
    } else {
      questionForm.resetFields()
    }
    setIsQuestionModalVisible(true)
  }

  // --- Auto-Builder Handlers ---
  const handleFileUpload = async (options) => {
    const { file, onSuccess, onError } = options;
    const formData = new FormData();
    formData.append('file', file);
    
    setUploadingFile(true);
    try {
      const res = await axios.post(`${API_BASE}/builder/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (res.data.status === 'success') {
        setDocText(prev => prev ? prev + '\n\n' + res.data.text : res.data.text);
        message.success('文件解析成功');
        onSuccess("ok");
      }
    } catch (error) {
      message.error(`文件解析失败: ${error.response?.data?.detail || error.message}`);
      onError(error);
    }
    setUploadingFile(false);
  };

  const handleExtract = async () => {
    if (!docText.trim()) {
      message.warning('请输入业务文档文本')
      return
    }
    setExtracting(true)
    try {
      const res = await axios.post(`${API_BASE}/builder/extract`, { document_text: docText })
      if (res.data.status === 'success' && res.data.data.knowledge_nodes) {
        setExtractedNodes(res.data.data.knowledge_nodes)
        message.success('解析成功，请预览并确认')
      } else {
        message.error('解析失败：未获取到结构化数据')
      }
    } catch (error) {
      message.error(`解析请求失败: ${error.response?.data?.detail || error.message}`)
    }
    setExtracting(false)
  }

  const handleSaveExtracted = async () => {
    if (extractedNodes.length === 0) return
    setSavingNodes(true)
    try {
      const res = await axios.post(`${API_BASE}/builder/save`, { knowledge_nodes: extractedNodes })
      message.success(res.data.message || '入库成功')
      setExtractedNodes([])
      setDocText('')
      setActiveTab('questions')
    } catch (error) {
      message.error(`入库失败: ${error.response?.data?.detail || error.message}`)
    }
    setSavingNodes(false)
  }

  // --- Table Columns ---
  const personaColumns = [
    { title: '角色名称', dataIndex: 'name', key: 'name', width: 150 },
    { title: '角色描述', dataIndex: 'description', key: 'description', width: 200 },
    { 
      title: '系统提示词 (System Prompt)', 
      dataIndex: 'system_prompt', 
      key: 'system_prompt',
      render: (text) => <div style={{ maxHeight: 60, overflow: 'hidden', textOverflow: 'ellipsis', WebkitLineClamp: 2, display: '-webkit-box', WebkitBoxOrient: 'vertical' }}>{text}</div>
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_, record) => (
        <Space size="middle">
          <Button type="text" icon={<EditOutlined />} onClick={() => openPersonaModal(record)}>编辑</Button>
          <Popconfirm title="确定删除该角色吗？" onConfirm={() => handleDeletePersona(record.id)}>
            <Button type="text" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const questionColumns = [
    { title: '分类', dataIndex: 'category', key: 'category', width: 140, render: (cat) => <Tag color="purple" style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{cat}</Tag> },
    { title: '场景描述 (题目)', dataIndex: 'scenario', key: 'scenario', width: 350 },
    { title: '难度', dataIndex: 'difficulty', key: 'difficulty', width: 80, render: (diff) => <Tag color={diff === 'hard' ? 'red' : 'blue'}>{diff}</Tag> },
    { title: '参考答案', dataIndex: 'reference_answer', key: 'reference_answer', ellipsis: true, width: 120 },
    { 
      title: '得分踩分点', 
      dataIndex: 'key_points', 
      key: 'key_points',
      width: 250,
      render: (points) => (
        <Space size={[0, 4]} wrap style={{ width: '100%' }}>
          {points?.map(p => <Tag key={p} style={{ whiteSpace: 'normal', wordBreak: 'break-word', height: 'auto', padding: '2px 7px' }}>{p}</Tag>)}
        </Space>
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Button type="text" icon={<EditOutlined />} onClick={() => openQuestionModal(record)}>编辑</Button>
          <Popconfirm title="确定删除该题目吗？" onConfirm={() => handleDeleteQuestion(record.id)}>
            <Button type="text" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  // 计算题库的分类列表
  const uniqueCategories = ['全部', ...new Set(questions.map(q => q.category))]
  const filteredQuestions = selectedCategory === '全部' ? questions : questions.filter(q => q.category === selectedCategory)

  return (
    <div>
      {/* 管理员顶部横幅 */}
      <div style={{
        background: 'linear-gradient(135deg, #001529 0%, #003eb3 100%)',
        borderRadius: 16,
        padding: '24px 28px',
        marginBottom: 20,
        color: '#fff',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', right: -10, top: -20, fontSize: 100, opacity: 0.06 }}>
          <DashboardOutlined />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 1 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, letterSpacing: '0.5px' }}>
              系统配置大厅
            </div>
            <div style={{ fontSize: 13, opacity: 0.75 }}>
              管理培训内容、知识库、Coze工作流与数据分析
            </div>
          </div>
          <Space size={12}>
            {prewarmStatus.status === 'ready' ? (
              <Tag color="success" style={{ borderRadius: 6, fontSize: 12, padding: '2px 10px' }}>
                ✓ 业务线就绪（{prewarmStatus.business_lines?.length || 0} 条）
              </Tag>
            ) : prewarmStatus.status === 'prewarming' ? (
              <Tag color="processing" style={{ borderRadius: 6, fontSize: 12 }}>预热中...</Tag>
            ) : (
              <Tag color="warning" style={{ borderRadius: 6, fontSize: 12 }}>未预热</Tag>
            )}
            <Button
              type={prewarmStatus.status === 'ready' ? 'default' : 'primary'}
              loading={prewarming || prewarmStatus.status === 'prewarming'}
              onClick={handlePrewarm}
              style={{ borderRadius: 8, background: prewarmStatus.status === 'ready' ? 'rgba(255,255,255,0.15)' : undefined, borderColor: prewarmStatus.status === 'ready' ? 'rgba(255,255,255,0.3)' : undefined, color: prewarmStatus.status === 'ready' ? '#fff' : undefined }}
            >
              {prewarmStatus.status === 'ready' ? '重新预热' : '预热业务线'}
            </Button>
          </Space>
        </div>
      </div>

      <Card style={{ minHeight: 600, borderRadius: 12, border: '1px solid #e8ecf1' }} styles={{ body: { padding: activeTab === null ? '28px' : '20px 24px' } }}>
        {(() => {
          const handleSelectModule = (key) => {
            setActiveTab(key)
            if (key === 'kb-manage') { fetchKbNodes(); fetchKbRelations() }
          }
          const moduleItems = [
            {
              key: 'personas',
              label: '客户人格配置 (Persona)',
              children: (
                <div>
                  <div style={{ marginBottom: 16 }}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openPersonaModal()}>
                      新增客户角色
                    </Button>
                    <Button icon={<ThunderboltOutlined />} onClick={() => setPersonaGeneratorVisible(true)} style={{ marginLeft: 8 }}>
                      AI生成人格
                    </Button>
                  </div>
                  <Table 
                    dataSource={personas} 
                    columns={personaColumns} 
                    rowKey="id" 
                    loading={loading}
                    pagination={{ pageSize: 8 }}
                  />
                </div>
              )
            },
            {
              key: 'questions',
              label: '练习题库管理 (Quiz)',
              children: (
                <div>
                  <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, marginRight: 16, maxWidth: 'calc(100% - 140px)' }}>
                      <Tabs 
                        activeKey={selectedCategory} 
                        onChange={setSelectedCategory} 
                        items={uniqueCategories.map(cat => ({ label: cat, key: cat }))} 
                        style={{ marginBottom: -16 }}
                      />
                    </div>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openQuestionModal()}>
                      新增练习题
                    </Button>
                  </div>
                  <Table 
                    dataSource={filteredQuestions} 
                    columns={questionColumns} 
                    rowKey="id" 
                    loading={loading}
                    pagination={{ pageSize: 8 }}
                    scroll={{ x: 1100 }}
                  />
                </div>
              )
            },
            {
              key: 'builder',
              label: '自动化教研 (Auto-Builder)',
              children: (
                <div>
                  <Typography.Paragraph>
                    将生肉（业务文档、规范、SOP）粘贴在下方，或直接上传 PDF/Word/TXT 文档，点击解析。大模型将自动提取「知识原子」并衍生出情景模拟题。
                  </Typography.Paragraph>
                  <div style={{ marginBottom: 16 }}>
                    <Upload 
                      customRequest={handleFileUpload} 
                      showUploadList={false} 
                      accept=".pdf,.docx,.txt,.md"
                    >
                      <Button icon={<UploadOutlined />} loading={uploadingFile}>
                        上传业务文档 (PDF/Word/TXT)
                      </Button>
                    </Upload>
                  </div>
                  <TextArea 
                    rows={8} 
                    placeholder="例如：输入《个人借记卡大额转账限制》相关规定..." 
                    value={docText}
                    onChange={e => setDocText(e.target.value)}
                  />
                  <div style={{ marginTop: 16, marginBottom: 32 }}>
                    <Button type="primary" loading={extracting} onClick={handleExtract}>
                      一键解析与造题
                    </Button>
                  </div>
                  
                  {extractedNodes.length > 0 && (
                    <Card title={`解析预览 (${extractedNodes.length} 个知识节点)`} bordered style={{ backgroundColor: '#f9f9f9' }}>
                      {extractedNodes.map((node, index) => (
                        <Card key={index} size="small" title={`${node.category} - ${node.title}`} style={{ marginBottom: 16 }}>
                          <p><strong>底层规则：</strong>{node.rule_content}</p>
                          <p><strong>关键词：</strong>{node.keywords?.map(k => <Tag key={k}>{k}</Tag>)}</p>
                          <div style={{ marginTop: 12 }}>
                            <strong>衍生题目 ({node.derived_questions?.length})：</strong>
                            {node.derived_questions?.map((dq, qIndex) => (
                              <Card key={qIndex} size="small" type="inner" style={{ marginTop: 8 }}>
                                <p><strong>客户提问：</strong>{dq.scenario}</p>
                                <p><strong>标准话术：</strong>{dq.reference_answer}</p>
                                <p><strong>得分点：</strong>{dq.key_points?.map(k => <Tag color="blue" key={k}>{k}</Tag>)}</p>
                              </Card>
                            ))}
                          </div>
                        </Card>
                      ))}
                      <div style={{ textAlign: 'right', marginTop: 16 }}>
                        <Button type="default" onClick={() => setExtractedNodes([])} style={{ marginRight: 16 }}>取消</Button>
                        <Button type="primary" onClick={handleSaveExtracted} loading={savingNodes}>确认并入库</Button>
                      </div>
                    </Card>
                  )}
                </div>
              )
            },
            {
              key: 'kb-manage',
              label: '知识库管理',
              children: (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                    <Space>
                      <Input.Search
                        placeholder="搜索知识库节点内容"
                        onSearch={handleKbSearch}
                        style={{ width: 300 }}
                        allowClear
                      />
                      <Tag color="blue">共 {kbNodes.total || 0} 个节点</Tag>
                    </Space>
                    <Space>
                      <Button
                        type="primary"
                        loading={classifying}
                        onClick={handleAutoClassify}
                      >
                        智能归类（LLM）
                      </Button>
                      <Button onClick={() => { setSelectedNodeIds([]); setNewBlModalVisible(true) }}>
                        新建业务线
                      </Button>
                      <Button onClick={fetchKbNodes}>刷新</Button>
                    </Space>
                  </div>

                  <div style={{ display: 'flex', gap: 16 }}>
                    {/* 左侧业务线分类 */}
                    <Card size="small" style={{ width: 200, flexShrink: 0 }} title="业务线分类" bodyStyle={{ padding: 0 }}>
                      <div style={{ cursor: 'pointer', padding: '8px 16px', backgroundColor: selectedBusinessLine === null ? '#e6f7ff' : 'transparent', fontWeight: selectedBusinessLine === null ? 600 : 400, borderLeft: selectedBusinessLine === null ? '3px solid #1890ff' : '3px solid transparent' }}
                        onClick={() => setSelectedBusinessLine(null)}>
                        全部 ({kbNodes.total || 0})
                      </div>
                      {kbNodes.stats?.map(stat => (
                        <div key={stat.business_line} style={{ cursor: 'pointer', padding: '8px 16px', backgroundColor: selectedBusinessLine === stat.business_line ? '#e6f7ff' : 'transparent', fontWeight: selectedBusinessLine === stat.business_line ? 600 : 400, borderLeft: selectedBusinessLine === stat.business_line ? '3px solid #1890ff' : '3px solid transparent' }}
                          onClick={() => setSelectedBusinessLine(stat.business_line)}>
                          {stat.business_line} ({stat.count})
                        </div>
                      ))}
                    </Card>

                    {/* 右侧节点列表 */}
                    <div style={{ flex: 1 }}>
                      <Table
                        dataSource={selectedBusinessLine ? (kbNodes.grouped?.[selectedBusinessLine] || []) : kbNodes.nodes}
                        columns={[
                          { title: '节点ID', dataIndex: 'node_id', key: 'node_id', width: 120 },
                          { title: '业务线', dataIndex: 'business_line', key: 'business_line', width: 120, render: (bl) => bl ? <Tag color="blue">{bl}</Tag> : <Tag color="default">未分类</Tag> },
                          { title: '内容', dataIndex: 'content', key: 'content', render: (content) => <span style={{ color: '#666' }}>{content?.substring(0, 20)}...</span> },
                          { title: '操作', key: 'action', width: 250, render: (_, record) => (
                            <Space>
                              <Button size="small" onClick={() => { setNodeDetail(record); setNodeDetailVisible(true) }}>详情</Button>
                              <Button size="small" onClick={() => setEditingNodeBl(record)}>改业务线</Button>
                              <Popconfirm title="确定删除该节点吗？" onConfirm={() => handleDeleteKbNode(record.node_id)}>
                                <Button size="small" danger>删除</Button>
                              </Popconfirm>
                            </Space>
                          ) }
                        ]}
                        rowKey="node_id"
                        loading={kbLoading}
                        pagination={{ pageSize: 10 }}
                        size="small"
                      />
                    </div>
                  </div>

                  <Card title={<Space>知识图谱关系 <Button size="small" type="link" onClick={() => { setGraphVisible(!graphVisible); if(!graphVisible) fetchKnowledgeGraph() }}>{graphVisible ? '收起图谱' : '查看图谱'}</Button></Space>} size="small" style={{ marginTop: 16 }}>
                    {graphVisible && (
                      <div style={{ border: '1px solid #d9d9d9', borderRadius: 4, padding: 16, marginBottom: 16 }}>
                        {graphData.nodes.length === 0 ? (
                          <Typography.Text type="secondary">暂无图谱数据</Typography.Text>
                        ) : (() => {
                          const connected = new Set(graphData.edges.flatMap(e => [e.source, e.target]))
                          const isolatedCount = graphData.nodes.filter(n => !connected.has(n.id)).length
                          return (
                            <>
                              <div style={{ marginBottom: 8 }}>
                                <Checkbox checked={showIsolatedNodes} onChange={(e) => setShowIsolatedNodes(e.target.checked)}>
                                  显示无关联节点（{isolatedCount} 个）
                                </Checkbox>
                              </div>
                              <div
                                ref={graphContainerRef}
                                style={{ width: '100%', height: 450, background: '#fafafa', borderRadius: 4 }}
                              />
                            </>
                          )
                        })()}
                        <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                          实线=相关/扩展/前置，虚线=矛盾 | 圆圈颜色=业务线（同色为同一业务线） | 可拖拽节点、滚轮缩放、悬停看完整内容
                          {graphData.nodes.length > 150 && `（节点较多，仅展示前 150 个）`}
                        </Typography.Text>
                      </div>
                    )}
                    <div style={{ marginBottom: 12 }}>
                      <Button size="small" type="primary" onClick={() => setRelationModalVisible(true)}>添加关系</Button>
                      <Button size="small" loading={buildingGraph} onClick={handleAutoBuildGraph} style={{ marginLeft: 8 }}>智能构建图谱</Button>
                      <Tag style={{ marginLeft: 8 }} color="blue">{kbRelations.length} 条关系</Tag>
                    </div>
                    <Table
                      dataSource={kbRelations}
                      columns={[
                        { title: '源节点', dataIndex: 'source_node_id', key: 'source', width: 120 },
                        { title: '关系类型', dataIndex: 'relation_type', key: 'type', width: 100, render: (t) => <Tag>{t}</Tag> },
                        { title: '权重', dataIndex: 'weight', key: 'weight', width: 80 },
                        { title: '目标节点', dataIndex: 'target_node_id', key: 'target', width: 120 },
                        { title: '操作', key: 'action', width: 80, render: (_, record) => (
                          <Popconfirm title="删除该关系？" onConfirm={() => handleDeleteRelation(record.id)}>
                            <Button size="small" danger>删除</Button>
                          </Popconfirm>
                        )}
                      ]}
                      rowKey="id"
                      size="small"
                      pagination={{ pageSize: 5 }}
                    />
                  </Card>

                  <Modal
                    title="添加知识图谱关系"
                    open={relationModalVisible}
                    onCancel={() => setRelationModalVisible(false)}
                    onOk={() => relationForm.submit()}
                  >
                    <Form form={relationForm} layout="vertical" onFinish={handleCreateRelation}>
                      <Form.Item name="source_node_id" label="源节点" rules={[{ required: true }]}>
                        <Select
                          showSearch
                          placeholder="选择源节点"
                          options={kbNodes.nodes?.map(n => ({ label: `${n.node_id}: ${n.content?.substring(0, 30)}...`, value: n.node_id }))}
                          filterOption={(input, option) => (option?.label ?? '').includes(input)}
                        />
                      </Form.Item>
                      <Form.Item name="target_node_id" label="目标节点" rules={[{ required: true }]}>
                        <Select
                          showSearch
                          placeholder="选择目标节点"
                          options={kbNodes.nodes?.map(n => ({ label: `${n.node_id}: ${n.content?.substring(0, 30)}...`, value: n.node_id }))}
                          filterOption={(input, option) => (option?.label ?? '').includes(input)}
                        />
                      </Form.Item>
                      <Form.Item name="relation_type" label="关系类型" initialValue="related">
                        <Select options={[
                          { label: '相关 (related)', value: 'related' },
                          { label: '前置条件 (prerequisite)', value: 'prerequisite' },
                          { label: '扩展 (extends)', value: 'extends' },
                          { label: '矛盾 (contradicts)', value: 'contradicts' }
                        ]} />
                      </Form.Item>
                      <Form.Item name="weight" label="权重 (0-1)" initialValue={1.0}>
                        <Input type="number" step="0.1" min="0" max="1" />
                      </Form.Item>
                    </Form>
                  </Modal>

                  {/* 修改业务线 Modal */}
                  <Modal
                    title="修改节点业务线"
                    open={!!editingNodeBl}
                    onCancel={() => setEditingNodeBl(null)}
                    onOk={() => handleUpdateNodeBl(editingNodeBl.node_id, editingNodeBl.business_line)}
                  >
                    <div style={{ marginBottom: 8 }}>节点ID: {editingNodeBl?.node_id}</div>
                    <Form.Item label="业务线">
                      <Select
                        value={editingNodeBl?.business_line}
                        onChange={(val) => setEditingNodeBl({ ...editingNodeBl, business_line: val })}
                        style={{ width: '100%' }}
                        allowClear
                        placeholder="选择或输入业务线"
                        mode="tags"
                        maxCount={1}
                        options={kbNodes.stats?.filter(s => s.business_line !== '未分类').map(s => ({ label: s.business_line, value: s.business_line }))}
                      />
                    </Form.Item>
                    <Typography.Text type="secondary">选择已有业务线或直接输入新业务线名称</Typography.Text>
                  </Modal>

                  {/* 新建业务线 Modal */}
                  <Modal
                    title="新建业务线"
                    open={newBlModalVisible}
                    onCancel={() => setNewBlModalVisible(false)}
                    onOk={() => newBlForm.submit()}
                  >
                    <Form form={newBlForm} layout="vertical" onFinish={handleCreateBl}>
                      <Form.Item name="name" label="业务线名称" rules={[{ required: true, message: '请输入业务线名称' }]}>
                        <Input placeholder="例如：贷款业务、外汇业务" />
                      </Form.Item>
                      <Form.Item label="归入该业务线的节点">
                        <Select
                          mode="multiple"
                          placeholder="选择要归入新业务线的节点（可选）"
                          style={{ width: '100%' }}
                          value={selectedNodeIds}
                          onChange={setSelectedNodeIds}
                          options={kbNodes.nodes.map(n => ({ label: `${n.node_id}: ${n.content?.substring(0, 30)}...`, value: n.node_id }))}
                          filterOption={(input, option) => (option?.label ?? '').includes(input)}
                        />
                      </Form.Item>
                    </Form>
                  </Modal>

                  {/* 节点详情 Modal */}
                  <Modal
                    title={`节点详情: ${nodeDetail?.node_id}`}
                    open={nodeDetailVisible}
                    onCancel={() => setNodeDetailVisible(false)}
                    footer={[<Button key="close" onClick={() => setNodeDetailVisible(false)}>关闭</Button>]}
                    width={600}
                  >
                    {nodeDetail && (
                      <div>
                        <p><strong>业务线：</strong>{nodeDetail.business_line ? <Tag color="blue">{nodeDetail.business_line}</Tag> : <Tag>未分类</Tag>}</p>
                        <p><strong>节点ID：</strong>{nodeDetail.node_id}</p>
                        <Divider />
                        <p><strong>完整内容：</strong></p>
                        <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto' }}>
                          {nodeDetail.content}
                        </div>
                      </div>
                    )}
                  </Modal>
                </div>
              )
            },
            {
              key: 'dashboard',
              label: <span><DashboardOutlined /> 数据大屏</span>,
              children: (
                <div>
                  {dashboardStats ? (
                    <>
                      <Row gutter={16} style={{ marginBottom: 24 }}>
                        <Col span={6}>
                          <Card><Statistic title="累计考试次数" value={dashboardStats.total_exams} /></Card>
                        </Col>
                        <Col span={6}>
                          <Card><Statistic title="考试平均分" value={dashboardStats.avg_exam_score} suffix="/100" valueStyle={{ color: dashboardStats.avg_exam_score >= 75 ? '#3f8600' : '#cf1322' }} /></Card>
                        </Col>
                        <Col span={6}>
                          <Card><Statistic title="累计练习次数" value={dashboardStats.total_practices} /></Card>
                        </Col>
                        <Col span={6}>
                          <Card><Statistic title="易错点总数" value={dashboardStats.top_weaknesses.length} /></Card>
                        </Col>
                      </Row>

                      <Row gutter={16}>
                        <Col span={12}>
                          <Card title="各维度平均得分" variant="borderless">
                            <div style={{ width: '100%', height: 300 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={[
                                  { subject: '业务准确性', A: dashboardStats.avg_dimensions.accuracy || 0, fullMark: 100 },
                                  { subject: '服务态度', A: dashboardStats.avg_dimensions.service_tone || 0, fullMark: 100 },
                                  { subject: '制度合规性', A: dashboardStats.avg_dimensions.compliance || 0, fullMark: 100 },
                                  { subject: '情绪安抚', A: dashboardStats.avg_dimensions.empathy || 0, fullMark: 100 },
                                  { subject: '沟通控场', A: dashboardStats.avg_dimensions.dialogue_control || 0, fullMark: 100 },
                                ]}>
                                  <PolarGrid />
                                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#333', fontSize: 12 }} />
                                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} />
                                  <Radar name="平均得分" dataKey="A" stroke="#1d39c4" fill="#1d39c4" fillOpacity={0.5} />
                                </RadarChart>
                              </ResponsiveContainer>
                            </div>
                          </Card>
                        </Col>
                        <Col span={12}>
                          <Card title="Top 10 易错点" variant="borderless">
                            <div style={{ width: '100%', height: 300 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart 
                                  data={dashboardStats.top_weaknesses} 
                                  layout="vertical"
                                  margin={{ left: 80, right: 20 }}
                                >
                                  <CartesianGrid strokeDasharray="3 3" />
                                  <XAxis type="number" />
                                  <YAxis dataKey="point" type="category" tick={{ fontSize: 11 }} width={80} />
                                  <Tooltip />
                                  <Bar dataKey="count" fill="#fa541c" name="出现次数" />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </Card>
                        </Col>
                      </Row>

                      <Card title="题库分类统计" variant="borderless" style={{ marginTop: 16 }}>
                        <Row gutter={16}>
                          {dashboardStats.category_stats.map(cat => (
                            <Col key={cat.category} span={6} style={{ marginBottom: 16 }}>
                              <Card size="small">
                                <Statistic title={cat.category} value={cat.count} suffix="题" />
                              </Card>
                            </Col>
                          ))}
                        </Row>
                      </Card>

                      <Card title="学员画像" size="small" style={{ marginTop: 16 }}>
                        <div style={{ marginBottom: 12 }}>
                          <Space wrap>
                            <Button size="small" type={selectedProfileTag === null ? 'primary' : 'default'} onClick={() => { setSelectedProfileTag(null); fetchProfiles(null) }}>全部</Button>
                            {profileTags.map(item => {
                              const tag = typeof item === 'string' ? item : item.tag
                              return (
                                <Button key={tag} size="small" type={selectedProfileTag === tag ? 'primary' : 'default'} onClick={() => { setSelectedProfileTag(tag); fetchProfiles(tag) }}>{tag}</Button>
                              )
                            })}
                          </Space>
                        </div>
                        <Table
                          dataSource={profileList}
                          loading={loadingProfiles}
                          rowKey="user_id"
                          size="small"
                          pagination={{ pageSize: 10 }}
                          columns={[
                            { title: '学员', dataIndex: 'name', key: 'name', width: 100 },
                            { title: '考试次数', dataIndex: 'exam_count', key: 'count', width: 80 },
                            { title: '平均分', dataIndex: 'avg_score', key: 'avg', width: 80, render: (s) => s ? s.toFixed(1) : '-' },
                            { title: '最高分', dataIndex: 'max_score', key: 'max', width: 80, render: (s) => s || '-' },
                            { title: '标签', dataIndex: 'tags', key: 'tags', render: (tags) => tags?.map(t => <Tag key={t} color="blue">{t}</Tag>) },
                            { title: '弱项', dataIndex: 'weakness_summary', key: 'weak', render: (w) => w || '无' }
                          ]}
                          locale={{ emptyText: '点击标签筛选学员' }}
                        />
                      </Card>
                    </>
                  ) : (
                    <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>加载中...</div>
                  )}
                </div>
              )
            },
            {
              key: 'papers',
              label: <span><FileTextOutlined /> 组卷发卷</span>,
              children: (
                <div>
                  <div style={{ marginBottom: 16 }}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsPaperModalVisible(true)}>
                      新建试卷
                    </Button>
                  </div>
                  <Table
                    dataSource={examPapers}
                    rowKey="id"
                    loading={loading}
                    pagination={{ pageSize: 8 }}
                    columns={[
                      { title: '试卷标题', dataIndex: 'title', key: 'title' },
                      { title: '题目数量', dataIndex: 'question_count', key: 'question_count', width: 100 },
                      { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 180, render: v => v ? new Date(v).toLocaleString() : '-' },
                      {
                        title: '操作', key: 'action', width: 360,
                        render: (_, record) => (
                          <Space>
                            <Button size="small" onClick={() => { setDistributingPaper(record); setSelectedTrainees([]); setDistributeModalVisible(true) }}>
                              下发试卷
                            </Button>
                            <Button size="small" onClick={() => fetchPaperAssignments(record.id)}>
                              查看下发
                            </Button>
                            <Button size="small" onClick={() => fetchPaperRecords(record.id)}>
                              做题记录
                            </Button>
                            <Popconfirm title="确定删除此试卷？" onConfirm={() => handleDeletePaper(record.id)}>
                              <Button size="small" danger icon={<DeleteOutlined />} />
                            </Popconfirm>
                          </Space>
                        )
                      }
                    ]}
                  />
                </div>
              )
            },
            {
              key: 'weaknesses',
              label: <span><WarningOutlined /> 学员错题画像</span>,
              children: (
                <Table
                  dataSource={allWeaknesses}
                  rowKey="id"
                  loading={loading}
                  pagination={{ pageSize: 10 }}
                  columns={[
                    { title: '学员', dataIndex: 'trainee_name', key: 'trainee_name', width: 100 },
                    { title: '分类', dataIndex: 'category', key: 'category', width: 120, render: v => <Tag color="blue">{v}</Tag> },
                    { title: '弱点标签', dataIndex: 'weak_points', key: 'weak_points', render: points => (points || []).map(p => <Tag color="orange" key={p}>{p}</Tag>) },
                    { title: '得分', dataIndex: 'score', key: 'score', width: 80, render: v => <span style={{ color: v < 60 ? '#ff4d4f' : v < 80 ? '#faad14' : '#52c41a' }}>{v}</span> },
                    { title: '来源', dataIndex: 'source_type', key: 'source_type', width: 80, render: v => v === 'exam' ? '考试' : '练习' },
                    { title: '已修正', dataIndex: 'resolved', key: 'resolved', width: 80, render: v => v ? <Tag color="green">已修正</Tag> : <Tag color="red">未修正</Tag> },
                    { title: '时间', dataIndex: 'created_at', key: 'created_at', width: 180, render: v => v ? new Date(v).toLocaleString() : '-' },
                  ]}
                />
              )
            },
            {
              key: 'projects',
              label: '项目场景配置 (PBL)',
              children: <ProjectScenariosTab />
            },
            {
              key: 'key-point-stats',
              label: <span><WarningOutlined /> 群体薄弱知识点</span>,
              children: <KeyPointStatsTab />
            },
            {
              key: 'coze-workflows',
              label: 'Coze 工作流注册',
              children: <CozeWorkflowRegistryTab />
            },
            {
              key: 'practice-nodes',
              label: '情景陪练题目管理',
              children: <PracticeNodeQuestionsTab />
            },
            {
              key: 'practice-drafts',
              label: <span><ThunderboltOutlined /> 陪练题目 AI 起草</span>,
              children: <PracticeQuestionDraftsTab />
            }
          ]

          if (!activeTab) {
            const groupColors = ['#1677ff', '#722ed1', '#13c2c2', '#fa8c16']
            return (
              <div>
                {MODULE_GROUPS.map((group, gi) => (
                  <div key={group.title} style={{ marginBottom: 28 }}>
                    <div style={{
                      marginBottom: 14, paddingBottom: 8,
                      borderBottom: `2px solid ${groupColors[gi]}20`,
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <div style={{ width: 4, height: 16, borderRadius: 2, background: groupColors[gi] }} />
                      <Typography.Title level={5} style={{ margin: 0, color: groupColors[gi] }}>{group.title}</Typography.Title>
                    </div>
                    <Row gutter={[16, 16]}>
                      {group.modules.map(m => (
                        <Col xs={24} sm={12} md={8} lg={6} key={m.key}>
                          <Card
                            hoverable
                            onClick={() => handleSelectModule(m.key)}
                            style={{
                              height: '100%', borderRadius: 10,
                              border: '1px solid #e8ecf1',
                              transition: 'all 0.25s',
                            }}
                            styles={{ body: { padding: '16px 18px' } }}
                          >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                              <div style={{
                                width: 42, height: 42, borderRadius: 10,
                                background: `${groupColors[gi]}12`,
                                color: groupColors[gi],
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 20, flexShrink: 0,
                              }}>
                                {m.icon}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, lineHeight: 1.4 }}>{m.label}</div>
                                <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5, display: 'block' }}>{m.desc}</Typography.Text>
                              </div>
                            </div>
                          </Card>
                        </Col>
                      ))}
                    </Row>
                  </div>
                ))}
              </div>
            )
          }

          const current = moduleItems.find(i => i.key === activeTab)
          return (
            <div>
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={() => setActiveTab(null)}
                style={{ marginBottom: 16, borderRadius: 8 }}
              >
                返回配置大厅
              </Button>
              <Typography.Title level={4} style={{ marginBottom: 16 }}>{current?.label}</Typography.Title>
              {current?.children}
            </div>
          )
        })()}
      </Card>

      {/* Persona Modal */}
      <Modal
        title={editingPersona ? "编辑客户角色" : "新增客户角色"}
        open={isPersonaModalVisible}
        onOk={() => personaForm.submit()}
        onCancel={() => setIsPersonaModalVisible(false)}
        width={700}
        destroyOnHidden
      >
        <Form form={personaForm} layout="vertical" onFinish={handleSavePersona}>
          <Form.Item name="name" label="角色名称" rules={[{ required: true }]}>
            <Input placeholder="例如：急躁型中年客户" />
          </Form.Item>
          <Form.Item name="description" label="简要描述">
            <Input placeholder="一句话描述该角色的特点" />
          </Form.Item>
          <Form.Item name="system_prompt" label="系统提示词 (System Prompt)" rules={[{ required: true }]} tooltip="大模型扮演该角色时的核心指令">
            <TextArea rows={6} placeholder="你是一个遇到转账失败问题，有些着急的普通银行客户..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* AI 人格生成器 Modal */}
      <Modal
        title="AI客户人格生成器"
        open={personaGeneratorVisible}
        onCancel={() => { setPersonaGeneratorVisible(false); setGeneratedPersona(null); setSelectedPersonaTags([]); setPersonaExtraNote('') }}
        width={700}
        footer={generatedPersona ? [
          <Button key="cancel" onClick={() => { setPersonaGeneratorVisible(false); setGeneratedPersona(null); setSelectedPersonaTags([]); setPersonaExtraNote('') }}>取消</Button>,
          <Button key="regenerate" onClick={() => { setGeneratedPersona(null); handleGeneratePersona() }}>重新生成</Button>,
          <Button key="save" type="primary" onClick={handleSaveGeneratedPersona}>保存到数据库</Button>
        ] : [
          <Button key="cancel" onClick={() => { setPersonaGeneratorVisible(false); setGeneratedPersona(null); setSelectedPersonaTags([]); setPersonaExtraNote('') }}>取消</Button>,
          <Button key="generate" type="primary" loading={generatingPersona} onClick={handleGeneratePersona}>生成</Button>
        ]}
      >
        {!generatedPersona ? (
          <div>
            <Typography.Paragraph type="secondary">
              点选下面的标签组合出客户特征，不用手动打字，AI将自动生成完整的人格配置（使用极速模型，约10-30秒）
            </Typography.Paragraph>
            {PERSONA_TAG_GROUPS.map(({ group, tags }) => (
              <div key={group} style={{ marginBottom: 12 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>{group}</Typography.Text>
                <Space size={[8, 8]} wrap>
                  {tags.map(tag => (
                    <Tag.CheckableTag
                      key={tag}
                      checked={selectedPersonaTags.includes(tag)}
                      onChange={(checked) => {
                        setSelectedPersonaTags(prev => checked ? [...prev, tag] : prev.filter(t => t !== tag))
                      }}
                    >
                      {tag}
                    </Tag.CheckableTag>
                  ))}
                </Space>
              </div>
            ))}
            <Divider style={{ margin: '12px 0' }} />
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>补充说明（可选，标签之外想额外强调的细节）</Typography.Text>
            <Input.TextArea
              rows={2}
              placeholder="例如：因为养老金没到账来打电话"
              value={personaExtraNote}
              onChange={e => setPersonaExtraNote(e.target.value)}
            />
            {selectedPersonaTags.length > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
                已选：{selectedPersonaTags.join('、')}
              </Typography.Text>
            )}
          </div>
        ) : (
          <div>
            <Typography.Title level={5}>生成结果预览</Typography.Title>
            <Card size="small" style={{ marginBottom: 16 }}>
              <p><strong>名称：</strong>{generatedPersona.name}</p>
              <p><strong>描述：</strong>{generatedPersona.description}</p>
              <p><strong>初始烦躁值：</strong>{generatedPersona.initial_anxiety} / <strong>阈值：</strong>{generatedPersona.threshold}</p>
            </Card>
            <Typography.Text strong>系统提示词：</Typography.Text>
            <Input.TextArea
              rows={8}
              value={generatedPersona.system_prompt}
              onChange={e => setGeneratedPersona({ ...generatedPersona, system_prompt: e.target.value })}
              style={{ marginTop: 8 }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
              可以直接编辑提示词，修改后点击"保存到数据库"
            </Typography.Text>
          </div>
        )}
      </Modal>

      {/* Question Modal */}
      <Modal
        title={editingQuestion ? "编辑练习题" : "新增练习题"}
        open={isQuestionModalVisible}
        onOk={() => questionForm.submit()}
        onCancel={() => setIsQuestionModalVisible(false)}
        width={700}
        destroyOnHidden
      >
        <Form form={questionForm} layout="vertical" onFinish={handleSaveQuestion} initialValues={{ category: '通用业务', difficulty: 'medium' }}>
          <Form.Item name="source_node_id" label="关联知识库节点" tooltip="选择关联的知识库节点后，题目分类将自动从节点业务线继承">
            <Select
              showSearch
              allowClear
              placeholder="输入关键词搜索知识库节点（可选）"
              style={{ width: '100%' }}
              filterOption={false}
              onSearch={handleSearchKbNodes}
              onChange={(val) => handleSelectKbNode(val)}
              options={kbNodeOptions}
              notFoundContent={kbSearching ? '搜索中...' : '输入关键词搜索'}
            />
          </Form.Item>
          <Form.Item name="category" label="题目分类（关联节点后自动填充）" rules={[{ required: true }]}>
            <Input placeholder="例如：信用卡业务、转账业务" />
          </Form.Item>
          <Form.Item name="scenario" label="场景描述 (题目)" rules={[{ required: true }]}>
            <TextArea rows={3} placeholder="客户询问：我的卡被吞了怎么办？" />
          </Form.Item>
          <Form.Item name="reference_answer" label="参考答案" rules={[{ required: true }]}>
            <TextArea rows={4} placeholder="标准客服回复话术..." />
          </Form.Item>
          <Form.Item name="key_points" label="得分踩分点 (以中文逗号分隔)" tooltip="评分 Agent 会根据这些踩分点来判断考生回答是否完整">
            <Input placeholder="例如：安抚情绪，核实身份，提示带身份证去网点" />
          </Form.Item>
          <Form.Item name="difficulty" label="难度等级" initialValue="medium">
            <Input placeholder="easy / medium / hard" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 组卷 Modal */}
      <Modal
        title="新建试卷"
        open={isPaperModalVisible}
        onOk={() => paperForm.submit()}
        onCancel={() => setIsPaperModalVisible(false)}
        width={800}
        destroyOnHidden
      >
        <Form form={paperForm} layout="vertical" onFinish={handleCreatePaper}>
          <Form.Item name="title" label="试卷标题" rules={[{ required: true }]}>
            <Input placeholder="例如：2024年Q3客服业务考核卷" />
          </Form.Item>
          <Form.Item name="question_ids" label="选择题目" rules={[{ required: true, message: '请至少选择一道题' }]}>
            <Select
              mode="multiple"
              placeholder="从题库中选择题目组成试卷"
              style={{ width: '100%' }}
              options={questions.map(q => ({
                label: `[${q.category}] ${q.scenario.substring(0, 30)}...`,
                value: q.id
              }))}
              filterOption={(input, option) => (option?.label ?? '').includes(input)}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 发卷 Modal */}
      <Modal
        title={`下发试卷：${distributingPaper?.title || ''}`}
        open={distributeModalVisible}
        onOk={handleDistribute}
        onCancel={() => setDistributeModalVisible(false)}
        okText="确认下发"
      >
        <Form layout="vertical">
          <Form.Item label="选择下发学员">
            <Select
              mode="multiple"
              placeholder="选择需要接收此试卷的学员"
              value={selectedTrainees}
              onChange={setSelectedTrainees}
              style={{ width: '100%' }}
              options={allTrainees.map(u => ({ label: u.username, value: u.id }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 下发记录 Drawer */}
      <Drawer
        title="试卷下发记录"
        open={assignmentDrawerVisible}
        onClose={() => setAssignmentDrawerVisible(false)}
        size={600}
      >
        <Table
          dataSource={paperAssignments}
          rowKey="assignment_id"
          pagination={false}
          columns={[
            { title: '学员', dataIndex: 'trainee_name', key: 'trainee_name' },
            { title: '状态', dataIndex: 'status', key: 'status', render: v => {
              const map = { pending: { color: 'orange', text: '待完成' }, in_progress: { color: 'blue', text: '进行中' }, completed: { color: 'green', text: '已完成' } }
              const m = map[v] || { color: 'default', text: v }
              return <Tag color={m.color}>{m.text}</Tag>
            }},
            { title: '下发时间', dataIndex: 'created_at', key: 'created_at', render: v => v ? new Date(v).toLocaleString() : '-' },
          ]}
        />
      </Drawer>

      {/* 做题记录详情 Modal */}
      <Modal
        title={`做题记录详情 (试卷ID: ${currentPaperId})`}
        open={paperRecordsVisible}
        onCancel={() => setPaperRecordsVisible(false)}
        footer={[<Button key="close" onClick={() => setPaperRecordsVisible(false)}>关闭</Button>]}
        width={800}
      >
        <Table
          dataSource={paperRecords}
          loading={loadingRecords}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 5 }}
          columns={[
            { title: '学员', dataIndex: 'trainee_name', key: 'name', width: 100 },
            { title: '分数', dataIndex: 'overall_score', key: 'score', width: 80, render: (s) => <Tag color={s >= 80 ? 'green' : s >= 60 ? 'orange' : 'red'}>{s}</Tag> },
            { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (s) => <Tag>{s || '已完成'}</Tag> },
            { title: '提交时间', dataIndex: 'exam_created_at', key: 'time', width: 150, render: (t) => t ? new Date(t).toLocaleString() : '-' },
            { title: '操作', key: 'action', width: 80, render: (_, record) => (
              <Button size="small" onClick={() => { setCurrentAnswerDetail(record); setAnswerDetailVisible(true) }}>查看答题</Button>
            ) }
          ]}
          locale={{ emptyText: '暂无做题记录' }}
        />
      </Modal>

      {/* 答题详情 Modal */}
      <Modal
        title={`${currentAnswerDetail?.trainee_name || ''} 的答题详情 - 总分: ${currentAnswerDetail?.overall_score ?? '-'}`}
        open={answerDetailVisible}
        onCancel={() => setAnswerDetailVisible(false)}
        footer={[<Button key="close" onClick={() => setAnswerDetailVisible(false)}>关闭</Button>]}
        width={750}
      >
        {currentAnswerDetail?.answers?.length > 0 ? (
          <div style={{ maxHeight: 500, overflow: 'auto' }}>
            {currentAnswerDetail.answers.map((ans, idx) => (
              <Card key={idx} size="small" style={{ marginBottom: 8 }} title={<Space>第{idx + 1}题 <Tag color={ans.score >= 80 ? 'green' : ans.score >= 60 ? 'orange' : 'red'}>{ans.score}分</Tag>{ans.category && <Tag>{ans.category}</Tag>}</Space>}>
                {ans.scenario && <Typography.Paragraph style={{ marginBottom: 4, color: '#666' }}><strong>题目场景：</strong>{ans.scenario}</Typography.Paragraph>}
                {ans.trainee_answer && <Typography.Paragraph style={{ marginBottom: 4 }}><strong>学员回答：</strong>{ans.trainee_answer}</Typography.Paragraph>}
                {ans.reference_answer && <Typography.Paragraph style={{ marginBottom: 4, color: '#52c41a' }}><strong>参考答案：</strong>{ans.reference_answer}</Typography.Paragraph>}
                {ans.feedback && <Typography.Paragraph style={{ marginBottom: 4 }}><strong>点评：</strong>{ans.feedback}</Typography.Paragraph>}
                {ans.missed_points?.length > 0 && <div><strong>未提及踩分点：</strong>{ans.missed_points.map((p, i) => <Tag key={i} color="red">{p}</Tag>)}</div>}
              </Card>
            ))}
          </div>
        ) : (
          <Typography.Text type="secondary">暂无答题详情（历史数据未保存逐题详情，新提交的试卷将显示完整详情）</Typography.Text>
        )}
      </Modal>
    </div>
  )
}

export default AdminDashboard