import React, { useState } from 'react'
import { Segmented } from 'antd'
import { ThunderboltOutlined, MessageOutlined } from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'
import DynamicExam from './DynamicExam'
import CozePracticeTrainee from './CozePracticeTrainee'

// 把"动态模拟考试"和"情景陪练(Coze)"收拢到同一个入口下的两个板块，
// 两边引擎（开放式LLM角色扮演+烦躁值 vs 固定工作流+得分点覆盖率）完全独立，
// 这里只是换了个入口壳子，互不影响，也互不共享状态。
const DynamicExamHub = () => {
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') === 'coze' ? 'coze' : 'ai'
  const [mode, setMode] = useState(initialTab)

  return (
    <div>
      <Segmented
        value={mode}
        onChange={setMode}
        style={{ marginBottom: 16 }}
        options={[
          { label: 'AI 人格模拟考试', value: 'ai', icon: <ThunderboltOutlined /> },
          { label: '情景陪练（业务线工作流）', value: 'coze', icon: <MessageOutlined /> },
        ]}
      />
      {mode === 'ai' ? <DynamicExam /> : <CozePracticeTrainee />}
    </div>
  )
}

export default DynamicExamHub
