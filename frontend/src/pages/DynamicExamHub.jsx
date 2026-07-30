import React, { useState } from 'react'
import { Segmented, Card, Typography, Space, Tag } from 'antd'
import { ThunderboltOutlined, MessageOutlined, RobotOutlined, ApiOutlined } from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'
import DynamicExam from './DynamicExam'
import CozePracticeTrainee from './CozePracticeTrainee'

const { Title, Paragraph } = Typography

const DynamicExamHub = () => {
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') === 'coze' ? 'coze' : 'ai'
  const [mode, setMode] = useState(initialTab)

  const modeInfo = {
    ai: {
      title: 'AI 人格模拟考试',
      desc: 'AI 扮演不同类型客户（急躁型/疑虑型/愤怒型等），实时模拟真实客服场景，考察你的应变能力、情绪管控和专业水平',
      tags: ['实时对话', '情绪反馈', '多轮交互', '烦躁值系统'],
      color: '#1677ff',
      bg: '#f0f5ff',
      icon: <ThunderboltOutlined />,
    },
    coze: {
      title: '情景陪练（业务线工作流）',
      desc: '基于预设业务流程的情景模拟，每道题有明确的得分要点，适合针对性练习标准话术和业务流程',
      tags: ['结构化场景', '踩点评分', '标准话术', '即时反馈'],
      color: '#722ed1',
      bg: '#f9f0ff',
      icon: <MessageOutlined />,
    },
  }

  return (
    <div>
      {/* 模式选择横幅 */}
      <div style={{
        background: `linear-gradient(135deg, ${modeInfo[mode].bg} 0%, #fff 100%)`,
        borderRadius: 16,
        padding: '24px 28px',
        marginBottom: 20,
        border: `1px solid ${modeInfo[mode].color}20`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: modeInfo[mode].color, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22,
            }}>
              {modeInfo[mode].icon}
            </div>
            <div>
              <Title level={4} style={{ margin: 0 }}>{modeInfo[mode].title}</Title>
            </div>
          </div>
          <Paragraph style={{ margin: '8px 0 0', color: '#595959', fontSize: 14 }}>
            {modeInfo[mode].desc}
          </Paragraph>
          <Space size={[6, 6]} wrap style={{ marginTop: 10 }}>
            {modeInfo[mode].tags.map(t => (
              <Tag key={t} color={mode === 'ai' ? 'blue' : 'purple'} style={{ borderRadius: 6, margin: 0 }}>{t}</Tag>
            ))}
          </Space>
        </div>
        <div style={{ flexShrink: 0 }}>
          <Segmented
            value={mode}
            onChange={setMode}
            size="large"
            options={[
              {
                label: (
                  <div style={{ padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <RobotOutlined /> AI模拟
                  </div>
                ),
                value: 'ai',
              },
              {
                label: (
                  <div style={{ padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ApiOutlined /> 情景陪练
                  </div>
                ),
                value: 'coze',
              },
            ]}
          />
        </div>
      </div>

      <Card
        styles={{ body: { padding: '0' } }}
        style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #e8ecf1' }}
      >
        {mode === 'ai' ? <DynamicExam /> : <CozePracticeTrainee />}
      </Card>
    </div>
  )
}

export default DynamicExamHub