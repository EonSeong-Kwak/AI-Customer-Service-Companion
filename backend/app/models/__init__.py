from sqlalchemy import Column, String, Integer, DateTime, Boolean, ForeignKey, JSON, Float
from sqlalchemy.sql import func
from app.core.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(String(255), primary_key=True, index=True)
    username = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(50), default="trainee") # "admin" or "trainee"
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Question(Base):
    __tablename__ = "questions"

    id = Column(String(255), primary_key=True, index=True)
    category = Column(String(100), default="通用业务", index=True) # 题目分类
    scenario = Column(String(1000), nullable=False)
    reference_answer = Column(String(2000), nullable=False)
    key_points = Column(JSON, default=list) # List of strings
    source_node_id = Column(String(255), nullable=True) # 关联外部知识库节点 ID
    difficulty = Column(String(50), default="medium")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Persona(Base):
    __tablename__ = "personas"

    id = Column(String(255), primary_key=True, index=True)
    name = Column(String(255), nullable=False) # e.g. "急躁型"
    system_prompt = Column(String(2000), nullable=False) # LLM 角色设定
    description = Column(String(1000), nullable=True)
    initial_anxiety = Column(Integer, default=20) # 初始烦躁值
    threshold = Column(Integer, default=80) # 烦躁值阈值，超过则可能挂断
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class ExamRecord(Base):
    __tablename__ = "exam_records"

    id = Column(String(255), primary_key=True, index=True)
    trainee_id = Column(String(255), ForeignKey("users.id"))
    persona_id = Column(String(255), ForeignKey("personas.id"))
    overall_score = Column(Integer, default=0)
    score_details = Column(JSON, default=dict) # 存储各维度得分 {"accuracy": 80, "service_tone": 90}
    feedback = Column(String(2000), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class ChatHistory(Base):
    __tablename__ = "chat_histories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    exam_id = Column(String(255), ForeignKey("exam_records.id"))
    role = Column(String(50), nullable=False) # "user" or "ai"
    content = Column(String(4000), nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

class PracticeRecord(Base):
    __tablename__ = "practice_records"

    id = Column(String(255), primary_key=True, index=True)
    trainee_id = Column(String(255), ForeignKey("users.id"))
    question_id = Column(String(255), ForeignKey("questions.id"))
    trainee_answer = Column(String(4000), nullable=False)
    ai_evaluation = Column(String(4000), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class UserWeakness(Base):
    """错题画像表：记录学员的弱点标签"""
    __tablename__ = "user_weaknesses"

    id = Column(String(255), primary_key=True, index=True)
    trainee_id = Column(String(255), ForeignKey("users.id"), index=True)
    category = Column(String(100), index=True)  # 题目分类，如"信用卡业务"
    weak_points = Column(JSON, default=list)  # 弱点标签列表，如["安抚情绪", "核实身份"]
    score = Column(Integer, default=0)  # 本次得分
    source_type = Column(String(50))  # "practice" 或 "exam"
    source_id = Column(String(255))  # practice_record_id 或 exam_record_id
    resolved = Column(Boolean, default=False)  # 是否已通过反向训练修正
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ExamPaper(Base):
    """试卷表：管理员组卷"""
    __tablename__ = "exam_papers"

    id = Column(String(255), primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    question_ids = Column(JSON, default=list)  # 包含的题目ID列表
    created_by = Column(String(255), ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ExamAssignment(Base):
    """发卷记录表：管理员给学员下发试卷"""
    __tablename__ = "exam_assignments"

    id = Column(String(255), primary_key=True, index=True)
    exam_paper_id = Column(String(255), ForeignKey("exam_papers.id"))
    trainee_id = Column(String(255), ForeignKey("users.id"), index=True)
    status = Column(String(50), default="pending")  # pending / in_progress / completed
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class FeynmanRecord(Base):
    """费曼复述记录表：追踪学员的知识点复述与理解度"""
    __tablename__ = "feynman_records"

    id = Column(String(255), primary_key=True, index=True)
    trainee_id = Column(String(255), ForeignKey("users.id"), index=True)
    topic = Column(String(255), nullable=False)  # 知识点主题
    paraphrase = Column(String(4000), nullable=False)  # 学员的复述内容
    understanding_score = Column(Integer, default=0)  # 理解度评分 0-100
    missing_points = Column(JSON, default=list)  # 遗漏的关键点
    is_accurate = Column(Boolean, default=False)  # 核心概念是否准确
    review_suggestion = Column(String(1000), nullable=True)  # 复习建议
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PomodoroSession(Base):
    """番茄钟会话记录表：追踪学员的学习节奏"""
    __tablename__ = "pomodoro_sessions"

    id = Column(String(255), primary_key=True, index=True)
    trainee_id = Column(String(255), ForeignKey("users.id"), index=True)
    module = Column(String(50), default="study")  # study / practice
    duration = Column(Integer, default=1500)  # 秒数，默认25分钟=1500秒
    status = Column(String(50), default="completed")  # completed / interrupted
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ReverseLoopRecord(Base):
    """反循环追踪记录表：记录错误分析、反向训练与验证结果"""
    __tablename__ = "reverse_loop_records"

    id = Column(String(255), primary_key=True, index=True)
    trainee_id = Column(String(255), ForeignKey("users.id"), index=True)
    weakness_id = Column(String(255), ForeignKey("user_weaknesses.id"), nullable=True)
    original_question_id = Column(String(255), nullable=True)
    error_analysis = Column(JSON, default=dict)  # {error_type, root_cause, missing_knowledge}
    reverse_question_id = Column(String(255), nullable=True)
    reverse_answer = Column(String(4000), nullable=True)
    verification_result = Column(String(50), default="pending")  # pending / corrected / need_reinforcement
    reinforcement_needed = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ===== V3.0 动态模拟考试系统 =====

class DynamicExam(Base):
    """动态考试记录表（V3.0）"""
    __tablename__ = "dynamic_exams"

    id = Column(String(255), primary_key=True, index=True)
    trainee_id = Column(String(255), ForeignKey("users.id"))
    persona_id = Column(String(255), ForeignKey("personas.id"), nullable=True)
    persona_type = Column(String(50))  # 急躁型/疑虑型/普通型/愤怒型
    initial_anxiety = Column(Integer, default=20)     # 初始烦躁值
    final_anxiety = Column(Integer, default=20)       # 最终烦躁值
    max_anxiety = Column(Integer, default=20)         # 最高烦躁值
    anxiety_threshold = Column(Integer, default=80)    # 烦躁值阈值
    total_rounds = Column(Integer, default=0)          # 实际轮数
    expected_rounds = Column(Integer, default=12)      # 预期轮数
    max_rounds = Column(Integer, default=15)           # 最大轮数
    business_lines_covered = Column(JSON, default=list)  # 覆盖的业务线
    key_points_hit = Column(JSON, default=list)        # 命中的踩分点
    business_score = Column(Integer, default=0)        # 业务分
    emotion_score = Column(Integer, default=0)         # 情绪管理分
    efficiency_score = Column(Integer, default=0)      # 效率分
    bonus_score = Column(Integer, default=0)           # 突发状况附加分
    overall_score = Column(Integer, default=0)         # 综合分
    status = Column(String(50), default="in_progress")  # in_progress / completed / failed / hangup
    chat_history = Column(JSON, default=list)          # 完整对话历史
    anxiety_history = Column(JSON, default=list)        # 烦躁值变化历史
    weakness_tags = Column(JSON, default=list)          # 生成的弱点标签
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)


class BusinessLineProgress(Base):
    """业务线目标完成记录表（V3.0）"""
    __tablename__ = "business_line_progress"

    id = Column(String(255), primary_key=True, index=True)
    exam_id = Column(String(255), ForeignKey("dynamic_exams.id"), index=True)
    business_line = Column(String(100))   # 业务线名称
    category = Column(String(100))        # 业务分类
    node_ids = Column(JSON, default=list)  # 使用的知识点节点ID
    key_points = Column(JSON, default=list)  # 该业务线的踩分点
    goals = Column(JSON, default=list)       # 业务目标列表
    goals_completed = Column(JSON, default=list)  # 已完成的目标
    rounds_used = Column(Integer, default=0)      # 使用的轮数
    rounds_expected = Column(Integer, default=5)  # 预期轮数
    score = Column(Integer, default=0)            # 业务线得分
    completed = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ===== V3.4 意图状态机 + PBL 项目制 =====

class ProjectScenario(Base):
    """PBL 项目场景表（V3.4）：一组有序任务构成完整业务流程"""
    __tablename__ = "project_scenarios"

    id = Column(String(255), primary_key=True, index=True)
    name = Column(String(255), nullable=False)             # 项目名称，如"完整投诉处理流程"
    description = Column(String(1000), nullable=True)      # 项目描述
    business_line = Column(String(100))                    # 关联业务线
    tasks = Column(JSON, default=list)                     # 任务列表（有序，每个含 name/weight/success_criteria/intents）
    difficulty = Column(String(50), default="medium")      # easy/medium/hard
    enabled = Column(Boolean, default=True)                # 是否启用
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class IntentDefinition(Base):
    """意图定义表（V3.4）：可复用的客户意图库"""
    __tablename__ = "intent_definitions"

    id = Column(String(255), primary_key=True, index=True)
    name = Column(String(255), nullable=False)             # 意图名称，如"询问挂失费用"
    business_line = Column(String(100))                    # 关联业务线
    success_criteria = Column(JSON, default=list)          # 成功标准关键词列表
    description = Column(String(1000), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class KnowledgeRelation(Base):
    """知识图谱关系表（MySQL版，替代Neo4j）"""
    __tablename__ = "knowledge_relations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source_node_id = Column(String(255), nullable=False, index=True)  # 源节点ID
    target_node_id = Column(String(255), nullable=False, index=True)  # 目标节点ID
    relation_type = Column(String(100), default="related")  # 关系类型：related, prerequisite, extends, contradicts
    weight = Column(Float, default=1.0)  # 关系权重0-1
    created_at = Column(DateTime(timezone=True), server_default=func.now())
