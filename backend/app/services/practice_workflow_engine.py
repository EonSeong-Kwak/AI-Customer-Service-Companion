"""
练习/通关 工作流编排服务（V6.0）

职责：按业务线找到对应的 Coze 工作流并驱动一场"从头跑到尾"的多轮问答；
Coze 不可用/未注册/中途报错时，无缝切换到本地兜底（完全基于 PracticeNodeQuestion 镜像表 +
quiz_agent，不依赖任何 Coze 调用），绝不因为 Coze 一侧的问题打断考生的练习体验。

会话结束后由本服务独立打分（不依赖 Coze 输出结构化分数）：
逐轮复用 quiz_agent.evaluate_answer，按"得分点覆盖率"判定通关模式的过关/不过关。
"""
import json
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CozeWorkflowRegistry, PracticeNodeQuestion, PracticeWorkflowSession, UserWeakness
from app.services.coze_workflow_client import coze_workflow_client
from app.services.llm_adapter import llm_client
from app.agents.quiz_agent import quiz_agent
from app.core.logger import logger

PASS_COVERAGE_THRESHOLD = 0.6  # 通关模式：得分点覆盖率 >= 该阈值才算通关
WEAKNESS_SCORE_THRESHOLD = 80  # 单轮得分低于该阈值时，未覆盖的得分点计入弱点标签


class PracticeWorkflowEngine:

    async def _get_registry(self, db: AsyncSession, business_line: str) -> Optional[CozeWorkflowRegistry]:
        stmt = select(CozeWorkflowRegistry).where(CozeWorkflowRegistry.business_line == business_line)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def _get_node_questions(self, db: AsyncSession, business_line: str) -> list[PracticeNodeQuestion]:
        stmt = (
            select(PracticeNodeQuestion)
            .where(PracticeNodeQuestion.business_line == business_line)
            .order_by(PracticeNodeQuestion.order_index.asc())
        )
        result = await db.execute(stmt)
        return list(result.scalars().all())

    def _build_resume_payload(self, required_params: Optional[list], answer: str) -> str:
        """Coze 续跑要求 resume_data 是 JSON 字符串，key 用上一次 Interrupt.required_parameters 里给的参数名
        （实测确认，直接传纯文本会续跑失败；不同工作流/节点的参数名可能不一样，不能写死）"""
        if required_params:
            return json.dumps({k: answer for k in required_params}, ensure_ascii=False)
        return answer

    async def _reword_for_tongguan(self, question_text: str, trace_id: str) -> str:
        """本地兜底下模拟"Coze 工作流内部 LLM 节点"对通关模式题目做的润色改写"""
        prompt = f"""请把下面这句银行客服培训场景里的"客户提问"适当润色改写一下——只改换用词、语气、细节（比如姓名、金额、具体原因），
不要改变问题本身考察的核心业务点。只输出改写后的一句话，不要任何多余说明。

原句：{question_text}"""
        try:
            result = await llm_client.async_chat_completion(
                [{"role": "user", "content": prompt}], trace_id=trace_id, model="chat"
            )
            reworded = result.strip().strip('"').strip("“”").strip()
            return reworded or question_text
        except Exception as e:
            logger.bind(trace_id=trace_id).warning(f"通关模式题目润色失败，使用原文兜底: {e}")
            return question_text

    async def start_session(
        self, db: AsyncSession, trainee_id: str, business_line: str, mode: str, trace_id: str = "N/A"
    ) -> dict:
        registry = await self._get_registry(db, business_line)
        registry_usable = bool(registry and registry.enabled)

        session_id = str(uuid.uuid4())
        session = PracticeWorkflowSession(
            id=session_id,
            trainee_id=trainee_id,
            business_line=business_line,
            mode=mode,
            status="in_progress",
            transcript=[],
        )

        first_question = None
        used_fallback = True

        if registry_usable and coze_workflow_client.enabled:
            mode_value = registry.practice_mode_value if mode == "practice" else registry.tongguan_mode_value
            step = await coze_workflow_client.start_run(
                workflow_id=registry.workflow_id,
                parameters={registry.mode_param_key: mode_value},
                bot_id=registry.bot_id,
                app_id=registry.app_id,
                trace_id=trace_id,
            )
            if step.status == "awaiting_input":
                first_question = step.message_text
                session.coze_workflow_id = registry.workflow_id
                session.current_event_id = step.event_id
                session.current_interrupt_type = step.interrupt_type
                session.current_required_params = step.required_params
                used_fallback = False
            else:
                logger.bind(trace_id=trace_id).warning(
                    f"Coze 工作流启动未进入可交互状态（status={step.status}, "
                    f"error={step.error_message}），降级为本地兜底"
                )

        if used_fallback:
            nodes = await self._get_node_questions(db, business_line)
            if not nodes:
                raise ValueError(f"业务线「{business_line}」既没有可用的 Coze 工作流，也没有本地兜底题目，无法开始练习")
            question_text = nodes[0].question_text
            if mode == "tongguan":
                question_text = await self._reword_for_tongguan(question_text, trace_id)
            first_question = question_text

        session.used_fallback = used_fallback
        session.transcript = [{
            "order_index": 0,
            "node_key": None,
            "question_text": first_question,
            "trainee_answer": None,
        }]
        db.add(session)
        await db.commit()
        await db.refresh(session)

        return {
            "session_id": session_id,
            "business_line": business_line,
            "mode": mode,
            "question": first_question,
            "status": "in_progress",
            "used_fallback": used_fallback,
        }

    async def submit_answer(
        self, db: AsyncSession, session: PracticeWorkflowSession, trainee_answer: str, trace_id: str = "N/A"
    ) -> dict:
        if session.status != "in_progress":
            raise ValueError("该会话已结束，无法继续作答")

        transcript = [dict(t) for t in (session.transcript or [])]
        if transcript:
            transcript[-1]["trainee_answer"] = trainee_answer
        session.transcript = transcript

        next_question = None
        finished = False

        if not session.used_fallback:
            resume_payload = self._build_resume_payload(session.current_required_params, trainee_answer)
            step = await coze_workflow_client.resume_run(
                workflow_id=session.coze_workflow_id,
                event_id=session.current_event_id,
                interrupt_type=session.current_interrupt_type,
                resume_data=resume_payload,
                trace_id=trace_id,
            )
            if step.status == "awaiting_input":
                next_question = step.message_text
                session.current_event_id = step.event_id
                session.current_interrupt_type = step.interrupt_type
                session.current_required_params = step.required_params
            elif step.status == "completed":
                finished = True
                if step.message_text:
                    session.coze_raw_output = step.message_text[:2000]
            else:
                logger.bind(trace_id=trace_id).warning(
                    f"Coze 工作流续跑失败（{step.error_message}），本场切换为本地兜底继续，不中断考生"
                )
                session.used_fallback = True

        if session.used_fallback and not finished and next_question is None:
            nodes = await self._get_node_questions(db, session.business_line)
            next_index = len(session.transcript)
            if next_index >= len(nodes):
                finished = True
            else:
                question_text = nodes[next_index].question_text
                if session.mode == "tongguan":
                    question_text = await self._reword_for_tongguan(question_text, trace_id)
                next_question = question_text

        if finished:
            await self._finish(db, session, trace_id)
            return {
                "session_id": session.id,
                "next_question": None,
                "status": "completed",
                "used_fallback": session.used_fallback,
            }

        transcript = [dict(t) for t in session.transcript]
        transcript.append({
            "order_index": len(transcript),
            "node_key": None,
            "question_text": next_question,
            "trainee_answer": None,
        })
        session.transcript = transcript
        db.add(session)
        await db.commit()
        return {
            "session_id": session.id,
            "next_question": next_question,
            "status": "in_progress",
            "used_fallback": session.used_fallback,
        }

    async def end_session(self, db: AsyncSession, session: PracticeWorkflowSession, trace_id: str = "N/A") -> PracticeWorkflowSession:
        """考生主动提前结束 / 前端兜底强制收尾时调用；已经跑完的会话再调用是幂等的"""
        if session.status == "in_progress":
            await self._finish(db, session, trace_id)
        return session

    async def _finish(self, db: AsyncSession, session: PracticeWorkflowSession, trace_id: str) -> None:
        session.status = "completed"
        session.completed_at = datetime.now()
        await self._score(db, session, trace_id)
        db.add(session)
        await db.commit()

    async def _score(self, db: AsyncSession, session: PracticeWorkflowSession, trace_id: str = "N/A") -> None:
        nodes = await self._get_node_questions(db, session.business_line)
        nodes_by_order = {n.order_index: n for n in nodes}

        total_key_points = set()
        hit_key_points = set()
        turn_scores = []
        weakness_points = []

        # 逐轮标注这一题是否真的参与了打分，以及没参与的原因——之前是静默跳过，考生/管理员
        # 完全看不出"这题没分是因为没答"还是"这题没配得分点"，报告里容易被误读成系统漏算
        transcript = [dict(t) for t in (session.transcript or [])]
        for t in transcript:
            t["scored"] = False
            t["score_skip_reason"] = None
            t["key_points"] = None
            t["missed_points"] = None
            t["score"] = None
            t["feedback"] = None

        for i, turn in enumerate(session.transcript or []):
            answer = turn.get("trainee_answer")
            node = nodes_by_order.get(i)
            if node:
                # 无论这一轮是否作答/打分成功，都先把这道题配置的得分点亮出来，
                # 报告里才能看清"这题原本要考什么"，而不是只有一个笼统的覆盖率数字
                transcript[i]["key_points"] = node.key_points or []
            if not answer:
                continue
            if not node:
                # Coze 工作流实跑的节点数比本地镜像表登记的多，没有参考答案/得分点可评分——
                # 答案仍保留在 transcript 里供人工查看，只是不参与自动打分
                transcript[i]["score_skip_reason"] = "该题尚未配置评分标准"
                continue

            try:
                evaluation = await quiz_agent.evaluate_answer(
                    turn.get("question_text") or "", node.reference_answer, node.key_points or [], answer,
                    trace_id=trace_id,
                )
            except Exception as e:
                logger.bind(trace_id=trace_id).warning(f"逐轮打分失败（order_index={i}）: {e}")
                transcript[i]["score_skip_reason"] = "评分服务异常，本题未计入统计"
                continue

            transcript[i]["scored"] = True

            # evaluate_answer 背后的 LLM 偶尔不按 JSON 格式老实回复（多余的前后缀文字/非法JSON），
            # 兜底解析器这时候会直接缺失 "score" 这个 key，而不是给 0——绝不能把"没解析出分数"
            # 当成"考生得了0分"，那样会把平均分拉得毫无意义地低。区分"缺失"(None) 和"合法但越界"
            # (比如实测出现过 113、5610 这种超出 0-100 的脏值，需要夹紧) 两种情况分开处理。
            raw_score = evaluation.get("score")
            score = max(0, min(100, raw_score)) if raw_score is not None else None
            missed = set(evaluation.get("missed_points", []) or [])
            transcript[i]["score"] = score
            transcript[i]["feedback"] = evaluation.get("feedback")
            transcript[i]["missed_points"] = list(missed)
            if score is not None:
                turn_scores.append(score)

            for kp in (node.key_points or []):
                total_key_points.add((i, kp))
                if kp not in missed:
                    hit_key_points.add((i, kp))

            if score is not None and score < WEAKNESS_SCORE_THRESHOLD and missed:
                weakness_points.extend(missed)

        key_points_total = len(total_key_points)
        key_points_hit = len(hit_key_points)
        overall_score = round(sum(turn_scores) / len(turn_scores)) if turn_scores else None
        weakness_tags = list(dict.fromkeys(weakness_points))  # 去重且保序

        if key_points_total == 0:
            # 没有任何一轮问答能对上「题目节点」里配置的参考答案/得分点——通常是这个业务线还没
            # 录入评分标准（比如刚接入 Coze 工作流但还没同步补题目节点）。这种情况下没有依据可判，
            # coverage_rate/passed 都应该是"无法判定"（None），不能算成 0% / 未通关，否则对考生是误导。
            coverage_rate = None
        else:
            coverage_rate = round(key_points_hit / key_points_total, 4)
        # "通关/不通关"只在通关模式下有意义；练习模式没有过关门槛这个概念，不应该显示 True/False
        passed = (coverage_rate >= PASS_COVERAGE_THRESHOLD) if (session.mode == "tongguan" and coverage_rate is not None) else None

        session.transcript = transcript
        session.key_points_total = key_points_total
        session.key_points_hit = key_points_hit
        session.coverage_rate = coverage_rate
        session.overall_score = overall_score
        session.passed = passed
        session.weakness_tags = weakness_tags

        if weakness_tags:
            db.add(UserWeakness(
                id=str(uuid.uuid4()),
                trainee_id=session.trainee_id,
                category=session.business_line,
                weak_points=weakness_tags,
                score=overall_score,
                source_type="practice",
                source_id=session.id,
            ))


practice_workflow_engine = PracticeWorkflowEngine()
