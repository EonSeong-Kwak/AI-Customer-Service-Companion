import asyncio
import uuid
from app.core.database import engine, get_db
from app.models import Persona, Question
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker

async def insert_test_data():
    async_session = sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    
    async with async_session() as session:
        print("开始插入测试数据...")
        
        # 1. 插入 Persona 测试数据
        test_personas = [
            Persona(
                id=str(uuid.uuid4()),
                name="[Test] 极其急躁型客户",
                system_prompt="你是一个[Test]急躁的银行客户，因为刚给老家转账5万失败被退回，你非常生气，觉得银行在故意扣你的钱。你需要客服立刻给你解决，态度很不耐烦。绝对不要怀疑客服的身份。",
                description="用于测试客服对急躁情绪的安抚能力"
            ),
            Persona(
                id=str(uuid.uuid4()),
                name="[Test] 啰嗦且迷糊型客户",
                system_prompt="你是一个[Test]老年银行客户，你想查养老金到了没。但你不会用智能手机，而且说话很啰嗦，经常扯到家里孩子的事情。你需要客服非常有耐心地引导你。",
                description="用于测试客服的耐心和引导能力"
            )
        ]
        
        for p in test_personas:
            session.add(p)
            
        # 2. 插入 Question 测试数据
        test_questions = [
            # 信用卡业务
            Question(
                id=str(uuid.uuid4()),
                category="[Test] 信用卡业务",
                scenario="客户打来电话：我刚收到你们的信用卡账单，怎么里面有一笔 300 块钱的年费？我之前办卡的时候你们不是说免年费的吗！",
                reference_answer="您好，非常抱歉给您带来困扰。我查了一下，您办理的是小白金卡，首年是免年费的，次年需要刷满 6 次才能免年费。如果您现在愿意刷够次数，我可以帮您申请减免这笔年费，您看可以吗？",
                key_points=["安抚情绪", "解释年费规则(刷满6次免)", "提供解决方案(申请减免)"],
                difficulty="medium"
            ),
            Question(
                id=str(uuid.uuid4()),
                category="[Test] 信用卡业务",
                scenario="客户询问：我的信用卡额度太低了，只有一万，我想申请提额到三万，该怎么操作？",
                reference_answer="您好，感谢您使用我行信用卡。提升额度可以通过我们的手机银行APP，在“信用卡-额度管理”中直接申请，系统会根据您的用卡和还款记录进行综合评估自动秒批。如果您需要，我现在也可以在系统里帮您提交提额申请，大概需要1-3个工作日审核，请问需要帮您提交吗？",
                key_points=["引导使用APP自主提额", "说明提额审核机制", "提供人工协助选项"],
                difficulty="easy"
            ),
            # 账户安全业务
            Question(
                id=str(uuid.uuid4()),
                category="[Test] 账户安全业务",
                scenario="客户非常着急：我刚才在超市买东西，突然收到短信说我的借记卡在境外被刷了 2000 块钱！这绝对不是我操作的，我的卡还在身上呢！",
                reference_answer="您好，请您先不要着急！为了保障您的资金安全，我现在立刻帮您对这张卡进行紧急挂失止付，防止资金继续损失。挂失后，请您立刻带上这张卡去最近的 ATM 机上随便操作一下（比如查询余额），保留好凭条，证明卡在您身上。随后我们会有专员联系您处理盗刷款项的追回。我现在就为您办理挂失，可以吗？",
                key_points=["安抚情绪并紧急止付", "指导客户保留卡片在身边的证据(去ATM操作)", "告知后续追回流程"],
                difficulty="hard"
            ),
            Question(
                id=str(uuid.uuid4()),
                category="[Test] 账户安全业务",
                scenario="客户询问：我的手机银行密码连续输错了三次，现在被锁定了，怎么办啊？里面还有急用钱。",
                reference_answer="您好，理解您的着急。手机银行登录密码连续输错三次会被锁定，这是为了保护您的账户安全。解锁非常简单，您可以直接在手机银行登录界面点击“忘记密码”，通过人脸识别和绑定手机号的短信验证码就可以重置密码了。如果您操作遇到困难，也可以带上身份证和银行卡到任意网点办理。",
                key_points=["解释锁定原因(安全保护)", "指导线上自助重置密码方法", "提供线下网点解决备选方案"],
                difficulty="easy"
            )
        ]
        
        for q in test_questions:
            session.add(q)
            
        await session.commit()
        print(f"成功插入 {len(test_personas)} 条测试 Persona 数据。")
        print(f"成功插入 {len(test_questions)} 条测试 Question 数据。")

if __name__ == "__main__":
    asyncio.run(insert_test_data())
