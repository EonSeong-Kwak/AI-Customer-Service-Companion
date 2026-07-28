"""
V3.4 意图状态机 + PBL 项目制
- IntentStateMachine: 维护客户意图栈，约束客户行为按业务流程推进
- ProjectManager: PBL 项目制，管理任务列表与任务切换
- 两者结合：项目任务驱动宏观流程，意图状态机驱动任务内的微观客户行为
"""
import random
from typing import Dict, List, Optional, Any
from loguru import logger


# ===== 默认意图模板库（按业务线组织）=====
# 每个业务线有一组有序的典型客户意图，用于约束客户行为
DEFAULT_INTENT_TEMPLATES: Dict[str, List[Dict]] = {
    "信用卡挂失": [
        {
            "name": "询问挂失费用",
            "success_criteria": ["费用", "50", "免费", "工本费"],
            "description": "客户想了解挂失是否收费、收多少"
        },
        {
            "name": "确认挂失生效时间",
            "success_criteria": ["即时", "立即", "马上", "生效", "冻结"],
            "description": "客户担心挂失后卡片还能否被盗刷"
        },
        {
            "name": "咨询新卡邮寄",
            "success_criteria": ["邮寄", "工作日", "加急", "送达", "几天"],
            "description": "客户关心新卡何时到手"
        }
    ],
    "密码重置": [
        {
            "name": "询问重置方式",
            "success_criteria": ["手机", "柜台", "网银", "渠道", "方式"],
            "description": "客户想了解有哪些重置渠道"
        },
        {
            "name": "确认所需材料",
            "success_criteria": ["身份证", "证件", "材料", "携带"],
            "description": "客户担心去柜台忘带东西"
        },
        {
            "name": "咨询生效时间",
            "success_criteria": ["立即", "即时", "生效", "多久"],
            "description": "客户想知道密码何时能用了"
        }
    ],
    "账户冻结": [
        {
            "name": "询问冻结原因",
            "success_criteria": ["原因", "司法", "风控", "久悬", "限额"],
            "description": "客户想知道为什么账户被冻"
        },
        {
            "name": "确认冻结范围",
            "success_criteria": ["全部", "部分", "限额", "范围"],
            "description": "客户想搞清是全额冻结还是限额冻结"
        },
        {
            "name": "咨询解冻流程",
            "success_criteria": ["解冻", "柜台", "材料", "流程", "多久"],
            "description": "客户想办理解冻"
        }
    ]
}


# ===== 默认 PBL 项目场景 =====
# 注意：每条默认场景的 business_line 必须唯一、且需与知识库实际识别出的业务线命名一致
# （如"卡片挂失"而非"信用卡挂失"），否则会导致：
# 1) random.choice 抽样时同一业务线权重过高，反复抽到同一个场景；
# 2) 该业务线对应的知识点/上下文注入找不到匹配的真实知识库内容。
DEFAULT_PROJECT_SCENARIOS: List[Dict] = [
    # ===== 示范样例：完整业务流程项目场景（V3.4 增强）=====
    # 数据结构在原有 weight/success_criteria/intents 基础上，
    # 补充 key_points/goals/max_rounds 字段，便于配置管理和前端展示。
    {
        "name": "信用卡挂失完整流程",
        "description": "模拟客户信用卡丢失后的完整处理流程：身份核验 → 办理挂失 → 盗刷处理，考验客服合规意识与应急处理能力",
        "business_line": "卡片挂失",
        "difficulty": "medium",
        "tasks": [
            {
                "name": "身份核验",
                "description": "核实来电人身份，确认其为持卡人本人，防范冒名挂失风险",
                "weight": 0.3,
                "success_criteria": ["身份证", "姓名", "卡号", "手机号", "验证"],
                "key_points": ["核实持卡人身份", "确认挂失卡片信息", "防范冒名挂失"],
                "goals": ["完成身份核验", "确认挂失卡片"],
                "max_rounds": 4,
                "intents": [
                    {"name": "报出基本信息", "success_criteria": ["卡号", "姓名", "身份证"], "description": "客户提供卡号和身份信息配合核验"},
                    {"name": "配合身份验证", "success_criteria": ["好", "是", "对", "收到"], "description": "客户配合完成验证码或信息核对"}
                ]
            },
            {
                "name": "办理挂失",
                "description": "为客户办理卡片挂失，说明挂失即时生效及费用标准",
                "weight": 0.4,
                "success_criteria": ["挂失", "冻结", "即时", "立即", "生效", "费用"],
                "key_points": ["说明挂失即时生效", "告知挂失费用标准", "确认挂失范围"],
                "goals": ["完成卡片挂失", "客户确认挂失信息"],
                "max_rounds": 4,
                "intents": [
                    {"name": "询问挂失费用", "success_criteria": ["费用", "50", "免费", "工本费"], "description": "客户想了解挂失是否收费、收多少"},
                    {"name": "确认挂失生效", "success_criteria": ["即时", "立即", "马上", "生效", "冻结"], "description": "客户担心挂失后卡片还能否被盗刷"}
                ]
            },
            {
                "name": "盗刷处理",
                "description": "针对客户反映的疑似盗刷交易，启动争议处理流程并提示报案",
                "weight": 0.3,
                "success_criteria": ["盗刷", "争议", "调单", "报案", "调查", "免责"],
                "key_points": ["记录盗刷交易明细", "启动争议处理流程", "提示客户报案", "告知免责条件"],
                "goals": ["登记盗刷交易", "启动争议调查", "客户接受处理方案"],
                "max_rounds": 5,
                "intents": [
                    {"name": "报告盗刷", "success_criteria": ["盗刷", "不是我的", "没刷", "被人刷"], "description": "客户报告卡片被盗刷的情况"},
                    {"name": "确认处理方案", "success_criteria": ["好的", "明白", "谢谢", "行"], "description": "客户接受争议处理方案"}
                ]
            }
        ]
    },
    {
        "name": "密码管理完整流程",
        "description": "模拟客户密码管理全流程：身份核验 → 密码重置 → 安全提示，考验客服合规操作与安全宣导能力",
        "business_line": "密码管理",
        "difficulty": "medium",
        "tasks": [
            {
                "name": "身份核验",
                "description": "核实客户身份，确认其有权进行密码重置操作",
                "weight": 0.3,
                "success_criteria": ["身份证", "姓名", "手机号", "验证码", "验证"],
                "key_points": ["核实客户身份", "确认账户归属", "防范冒名重置"],
                "goals": ["完成身份核验", "确认重置权限"],
                "max_rounds": 4,
                "intents": [
                    {"name": "提供身份信息", "success_criteria": ["身份证", "姓名", "手机号"], "description": "客户提供身份信息配合核验"},
                    {"name": "配合验证", "success_criteria": ["好", "是", "对", "收到验证码"], "description": "客户配合完成短信验证码验证"}
                ]
            },
            {
                "name": "密码重置",
                "description": "指导客户通过合适渠道完成密码重置，并确认新密码生效",
                "weight": 0.4,
                "success_criteria": ["重置", "新密码", "设置", "修改", "生效"],
                "key_points": ["告知重置渠道", "指导设置新密码", "确认重置生效"],
                "goals": ["完成密码重置", "客户知晓新密码生效"],
                "max_rounds": 4,
                "intents": [
                    {"name": "询问重置方式", "success_criteria": ["手机", "柜台", "网银", "渠道", "方式"], "description": "客户想了解有哪些重置渠道"},
                    {"name": "确认重置结果", "success_criteria": ["立即", "即时", "生效", "多久", "好了"], "description": "客户想知道密码何时能用了"}
                ]
            },
            {
                "name": "安全提示",
                "description": "向客户宣导密码安全使用规范，提示泄露风险",
                "weight": 0.3,
                "success_criteria": ["安全", "提示", "建议", "保管", "泄露", "不要"],
                "key_points": ["提示密码保管建议", "告知密码泄露风险", "建议定期更换密码"],
                "goals": ["客户了解安全用密规范", "客户确认理解"],
                "max_rounds": 3,
                "intents": [
                    {"name": "询问安全建议", "success_criteria": ["安全", "注意", "建议", "怎么保管"], "description": "客户想了解密码安全使用建议"},
                    {"name": "确认理解", "success_criteria": ["好的", "明白", "知道了", "谢谢"], "description": "客户确认已理解安全提示"}
                ]
            }
        ]
    },
    {
        "name": "账户冻结排查流程",
        "description": "模拟客户账户被冻结后的排查处理流程：了解情况 → 冻结操作说明 → 解冻指导，考验客服问题诊断与流程指引能力",
        "business_line": "账户管控",
        "difficulty": "hard",
        "tasks": [
            {
                "name": "了解情况",
                "description": "了解客户诉求，核实账户状态，确认冻结类型",
                "weight": 0.3,
                "success_criteria": ["冻结", "原因", "查询", "核实", "看一下"],
                "key_points": ["了解客户诉求", "核实账户状态", "确认冻结类型"],
                "goals": ["确认账户被冻结", "获取账户信息"],
                "max_rounds": 4,
                "intents": [
                    {"name": "描述冻结情况", "success_criteria": ["不能用", "被冻", "转不出", "异常"], "description": "客户描述账户无法使用的情况"},
                    {"name": "配合查询", "success_criteria": ["好", "卡号", "身份证", "姓名"], "description": "客户配合提供账户信息供查询"}
                ]
            },
            {
                "name": "冻结操作说明",
                "description": "向客户说明账户冻结的原因、范围和期限",
                "weight": 0.4,
                "success_criteria": ["冻结", "司法", "风控", "限额", "保护", "申请"],
                "key_points": ["说明冻结原因", "告知冻结范围", "解释冻结期限"],
                "goals": ["客户了解冻结原因", "客户知晓冻结范围"],
                "max_rounds": 4,
                "intents": [
                    {"name": "询问冻结原因", "success_criteria": ["原因", "司法", "风控", "久悬", "限额"], "description": "客户想知道为什么账户被冻"},
                    {"name": "确认冻结范围", "success_criteria": ["全部", "部分", "限额", "范围"], "description": "客户想搞清是全额冻结还是限额冻结"}
                ]
            },
            {
                "name": "解冻指导",
                "description": "指导客户办理解冻手续，告知所需材料和办理渠道",
                "weight": 0.3,
                "success_criteria": ["解冻", "柜台", "材料", "流程", "多久", "工作日"],
                "key_points": ["告知解冻所需材料", "说明解冻办理渠道", "提示解冻时效"],
                "goals": ["客户知晓解冻流程", "客户确认理解"],
                "max_rounds": 4,
                "intents": [
                    {"name": "询问解冻流程", "success_criteria": ["解冻", "柜台", "材料", "流程", "多久"], "description": "客户想办理解冻"},
                    {"name": "确认解冻方案", "success_criteria": ["好的", "明白", "谢谢", "行"], "description": "客户确认理解解冻方案"}
                ]
            }
        ]
    }
]


class IntentStateMachine:
    """
    意图状态机：维护客户意图栈，约束客户行为按业务流程推进。

    职责：
    1. 维护当前意图和历史意图栈
    2. 检测当前意图是否完成（基于考生回答命中 success_criteria）
    3. 根据人格切换概率决定是否切换到下一个意图
    4. 连续3轮无推进时强制切换意图（打破死循环）
    """

    # 不同人格的意图切换概率（当前意图完成后，是否立即推进到下一个意图）
    PERSONA_SWITCH_PROBABILITY = {
        "急躁型": 0.9,      # 急躁型客户目标明确，推进快
        "疑虑型": 0.5,      # 疑虑型客户可能在当前意图上多问几句
        "普通型": 0.8,      # 普通型客户正常推进
        "愤怒型": 0.7,      # 愤怒型客户推进但情绪化
        "话题跳跃型": 0.4,  # 话题跳跃型客户容易跳到其他意图
    }

    # 强制切换的连续无推进轮数阈值
    FORCE_SWITCH_ROUNDS = 3

    def __init__(self, intent_sequence: List[Dict], persona_type: str = "普通型"):
        """
        Args:
            intent_sequence: 意图序列，每个意图含 name/success_criteria/description
            persona_type: 人格类型，决定切换概率
        """
        self.intent_sequence = intent_sequence or []
        self.persona_type = persona_type
        self.current_index = 0
        self.intent_stack = []          # 已完成的意图历史
        self.no_progress_count = 0      # 连续无推进轮数
        self.switch_probability = self.PERSONA_SWITCH_PROBABILITY.get(
            persona_type, 0.8
        )

    @property
    def current_intent(self) -> Optional[Dict]:
        """获取当前意图"""
        if self.current_index < len(self.intent_sequence):
            intent = dict(self.intent_sequence[self.current_index])
            intent["index"] = self.current_index
            intent["completed"] = False
            return intent
        return None

    @property
    def is_all_completed(self) -> bool:
        """所有意图是否都已完成"""
        return self.current_index >= len(self.intent_sequence)

    @property
    def completed_count(self) -> int:
        """已完成的意图数"""
        return self.current_index

    @property
    def total_count(self) -> int:
        """总意图数"""
        return len(self.intent_sequence)

    def check_intent_completion(self, trainee_answer: str) -> bool:
        """
        检查当前意图是否被考生回答命中完成。

        Args:
            trainee_answer: 考生本轮回答
        Returns:
            是否完成当前意图
        """
        intent = self.current_intent
        if not intent:
            return True

        criteria = intent.get("success_criteria", [])
        hit = any(kw in trainee_answer for kw in criteria) if criteria else False
        return hit

    def advance(self, trainee_answer: str, force: bool = False) -> Dict:
        """
        推进意图状态机。

        Args:
            trainee_answer: 考生本轮回答
            force: 是否强制推进（用于打破死循环）
        Returns:
            状态变更信息
        """
        result = {
            "intent_completed": False,
            "intent_switched": False,
            "previous_intent": None,
            "current_intent": None,
            "switch_reason": None,
            "no_progress_count": self.no_progress_count
        }

        if self.is_all_completed:
            result["current_intent"] = None
            return result

        intent = self.current_intent
        result["current_intent"] = intent

        # 检查当前意图是否完成
        completed = self.check_intent_completion(trainee_answer)

        if completed:
            # 意图完成
            self.intent_stack.append(intent["name"])
            self.no_progress_count = 0
            result["intent_completed"] = True
            result["previous_intent"] = intent["name"]

            # 根据切换概率决定是否推进
            if force or random.random() < self.switch_probability:
                self.current_index += 1
                result["intent_switched"] = True
                result["switch_reason"] = "强制切换" if force else "概率切换"
                result["current_intent"] = self.current_intent
            else:
                result["switch_reason"] = "概率未命中，保持当前意图"
        else:
            # 意图未完成
            self.no_progress_count += 1
            result["no_progress_count"] = self.no_progress_count

            # 连续无推进达到阈值，强制切换
            if self.no_progress_count >= self.FORCE_SWITCH_ROUNDS:
                self.intent_stack.append(intent["name"] + "(未完成)")
                self.no_progress_count = 0
                self.current_index += 1
                result["intent_switched"] = True
                result["intent_completed"] = True  # 标记为已完成（强制跳过）
                result["previous_intent"] = intent["name"]
                result["switch_reason"] = f"连续{self.FORCE_SWITCH_ROUNDS}轮无推进，强制切换"
                result["current_intent"] = self.current_intent

        return result

    def get_state_snapshot(self) -> Dict:
        """获取状态机快照（用于前端展示）"""
        return {
            "current_intent": self.current_intent,
            "intent_stack": self.intent_stack,
            "current_index": self.current_index,
            "total_intents": self.total_count,
            "completed_intents": self.completed_count,
            "is_all_completed": self.is_all_completed,
            "no_progress_count": self.no_progress_count,
            "switch_probability": self.switch_probability
        }

    def get_intent_prompt(self) -> str:
        """生成当前意图的 prompt 提示，注入到客户 system_prompt 中"""
        intent = self.current_intent
        if not intent:
            return ""

        return (
            f"\n\n【当前你的核心诉求】（请围绕这个诉求提问，不要跑偏）：\n"
            f"诉求：{intent['name']}\n"
            f"说明：{intent.get('description', '')}\n"
            f"如果客服已经清楚回答了这个诉求，请自然接受并推进到下一个诉求。"
        )


class ProjectManager:
    """
    PBL 项目管理器：管理项目任务列表与任务切换。

    职责：
    1. 维护任务列表和当前任务索引
    2. 检测当前任务是否完成（基于成功标准）
    3. 任务完成后切换到下一个任务，并初始化该任务的意图状态机
    4. 记录每个任务使用的轮数
    """

    def __init__(self, project_config: Dict, persona_type: str = "普通型"):
        """
        Args:
            project_config: 项目配置，含 name/tasks 等
            persona_type: 人格类型
        """
        self.project_name = project_config.get("name", "")
        self.project_description = project_config.get("description", "")
        self.tasks = project_config.get("tasks", [])
        self.persona_type = persona_type
        self.current_task_index = 0
        self.task_rounds = [0] * len(self.tasks)  # 每个任务使用的轮数
        self.task_completed = [False] * len(self.tasks)

        # 为当前任务初始化意图状态机
        self._intent_machine: Optional[IntentStateMachine] = None
        self._init_intent_machine()

    def _init_intent_machine(self):
        """为当前任务初始化意图状态机"""
        task = self.current_task
        if task:
            intents = task.get("intents", [])
            self._intent_machine = IntentStateMachine(intents, self.persona_type)
        else:
            self._intent_machine = None

    @property
    def current_task(self) -> Optional[Dict]:
        """获取当前任务"""
        if self.current_task_index < len(self.tasks):
            return self.tasks[self.current_task_index]
        return None

    @property
    def is_all_completed(self) -> bool:
        """所有任务是否都已完成"""
        return self.current_task_index >= len(self.tasks)

    @property
    def completed_task_count(self) -> int:
        """已完成的任务数"""
        return sum(1 for c in self.task_completed if c)

    @property
    def total_task_count(self) -> int:
        """总任务数"""
        return len(self.tasks)

    @property
    def intent_machine(self) -> Optional[IntentStateMachine]:
        """获取当前任务的意图状态机"""
        return self._intent_machine

    def check_task_completion(self, trainee_answer: str) -> bool:
        """
        检查当前任务是否被考生回答命中完成。

        Args:
            trainee_answer: 考生本轮回答
        Returns:
            是否完成当前任务
        """
        task = self.current_task
        if not task:
            return True

        criteria = task.get("success_criteria", [])
        return any(kw in trainee_answer for kw in criteria) if criteria else False

    def advance(self, trainee_answer: str) -> Dict:
        """
        推进项目管理器：先推进意图状态机，再检查任务完成。

        Args:
            trainee_answer: 考生本轮回答
        Returns:
            状态变更信息
        """
        result = {
            "intent_state": None,
            "task_completed": False,
            "task_switched": False,
            "previous_task": None,
            "current_task": None,
            "switch_reason": None
        }

        if self.is_all_completed:
            result["current_task"] = None
            return result

        # 记录当前任务使用的轮数
        self.task_rounds[self.current_task_index] += 1

        # 1. 先推进意图状态机
        if self._intent_machine:
            intent_result = self._intent_machine.advance(trainee_answer)
            result["intent_state"] = intent_result
        else:
            intent_result = None

        # 2. 检查任务完成
        # 任务完成的条件：意图状态机所有意图完成 OR 任务成功标准命中
        intent_all_done = self._intent_machine and self._intent_machine.is_all_completed
        task_criteria_hit = self.check_task_completion(trainee_answer)

        if intent_all_done or task_criteria_hit:
            # 任务完成
            task = self.current_task
            self.task_completed[self.current_task_index] = True
            result["task_completed"] = True
            result["previous_task"] = task["name"]

            # 切换到下一个任务
            self.current_task_index += 1
            self._init_intent_machine()
            result["task_switched"] = True
            result["switch_reason"] = "任务成功标准达成" if task_criteria_hit else "所有意图完成"
            result["current_task"] = self.current_task
        else:
            result["current_task"] = self.current_task

        return result

    def get_state_snapshot(self) -> Dict:
        """获取项目管理器快照（用于前端展示）"""
        return {
            "project_name": self.project_name,
            "project_description": self.project_description,
            "current_task": self.current_task,
            "current_task_index": self.current_task_index,
            "total_tasks": self.total_task_count,
            "completed_tasks": self.completed_task_count,
            "is_all_completed": self.is_all_completed,
            "task_rounds": self.task_rounds,
            "task_completed": self.task_completed,
            "intent_state": self._intent_machine.get_state_snapshot() if self._intent_machine else None
        }

    def get_task_prompt(self) -> str:
        """生成当前任务的 prompt 提示，注入到客户 system_prompt 中"""
        task = self.current_task
        if not task:
            return ""

        prompt = (
            f"\n\n【当前对话阶段】（PBL 项目制）：\n"
            f"项目：{self.project_name}\n"
            f"当前任务：{task['name']}\n"
            f"任务说明：{task.get('description', '请围绕这个任务展开对话')}\n"
        )

        # 附加意图提示
        if self._intent_machine:
            prompt += self._intent_machine.get_intent_prompt()

        return prompt


# ===== 单业务线模式的意图状态机工厂 =====

def build_intent_machine_for_business_line(
    business_line: str,
    persona_type: str = "普通型",
    key_points: List[Dict] = None
) -> IntentStateMachine:
    """
    为单业务线模式构建意图状态机。
    优先使用业务线对应的默认意图模板，如果没有则基于踩分点生成意图序列。

    Args:
        business_line: 业务线名称
        persona_type: 人格类型
        key_points: 踩分点列表（用于降级生成意图）
    Returns:
        IntentStateMachine 实例
    """
    # 优先使用默认模板
    if business_line in DEFAULT_INTENT_TEMPLATES:
        intent_sequence = DEFAULT_INTENT_TEMPLATES[business_line]
        logger.info(f"业务线 '{business_line}' 使用默认意图模板，共 {len(intent_sequence)} 个意图")
    elif key_points:
        # 基于踩分点生成意图序列
        intent_sequence = []
        for kp in key_points[:3]:
            intent_sequence.append({
                "name": f"推进：{kp['point']}",
                "success_criteria": kp.get("keywords", []),
                "description": f"客户关注 {kp['point']} 相关问题"
            })
        logger.info(f"业务线 '{business_line}' 基于踩分点生成 {len(intent_sequence)} 个意图")
    else:
        # 完全降级：使用通用意图序列
        intent_sequence = [
            {
                "name": "描述问题",
                "success_criteria": ["问题", "怎么办", "怎么"],
                "description": "客户描述自己的问题"
            },
            {
                "name": "确认方案",
                "success_criteria": ["好的", "明白", "行", "可以"],
                "description": "客户确认接受方案"
            }
        ]
        logger.info(f"业务线 '{business_line}' 使用通用意图模板")

    return IntentStateMachine(intent_sequence, persona_type)
